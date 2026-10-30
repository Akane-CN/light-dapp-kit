import { ccc } from "@ckb-ccc/core";
import type { LightClient } from "ckb-light-client-js";
import { buildLightClientToml, resolveNetwork, resolveWatchStart, type NetworkConfig, type NetworkName } from "./config.js";
import { DEFAULT_RETRY, FailureTracker, backoffDelay, type RetryPolicy } from "./retry.js";
import { SyncMachine, type SyncState } from "./sync.js";
import { WatchList, type WatchEntry } from "./watch.js";
import { loadMeta, saveMeta, clearDatabases } from "./storage.js";

/**
 * `ckb-light-client-js` is ~10 MB (two inlined workers + WASM). It is imported lazily on
 * `start()` so the host app renders before the download begins; bundlers split it into
 * its own chunk.
 */
type LcModule = typeof import("ckb-light-client-js");
let lcModulePromise: Promise<LcModule> | undefined;
function loadLightClientModule(): Promise<LcModule> {
  return (lcModulePromise ??= import("ckb-light-client-js"));
}

export interface LightClientOptions {
  network: NetworkName;
  /** Override bootnodes, db name, fee rate, watch depth. */
  config?: Partial<NetworkConfig>;
  /** Poll interval for tips/peers in ms. */
  pollIntervalMs?: number;
  logLevel?: "trace" | "debug" | "info" | "error";
  /** Automatic retry behaviour for boot and poll failures. */
  retry?: Partial<RetryPolicy>;
}

/**
 * A ccc.Client whose data source is the CKB light client running in a Web Worker.
 *
 * We extend the public-network clients so that known scripts, address prefix and
 * transaction helpers come for free; only the methods that would hit JSON-RPC are
 * overridden and forwarded to `ckb-light-client-js`.
 *
 * Verified against @ckb-ccc/core 1.23: `ClientJsonRpc` defines the RPC-backed
 * methods as instance properties (built by `buildSender`), so they must be
 * overridden as class fields, not as prototype methods. Keep the adapter
 * contract test (client.test.ts) covering every overridden member.
 *
 * `ckb-light-client-js` bundles its own `@ckb-ccc/core@0.1.0-alpha.6`; the
 * two type graphs are structurally compatible at runtime but not assignable,
 * so values are cast once at the boundary (see `toLcTx`).
 */
// The data source is identical on both networks; only CCC's known-script table and address
// prefix differ, and those come from the base class. So the implementation is a mixin applied
// to both ClientPublicTestnet and ClientPublicMainnet, chosen per network by
// createLightClientCccClient. (Extending only the testnet client gave mainnet users testnet
// script hashes and ckt1 addresses.)
/** The light-client lifecycle and watch surface the kit adds on top of ccc.Client. */
export interface LightClientController {
  readonly cfg: NetworkConfig;
  readonly sync: SyncMachine;
  readonly watches: WatchList;
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
  retry(): void;
  reset(): Promise<void>;
  syncState(): SyncState;
  onSyncState(cb: (s: SyncState) => void): () => void;
  watch(script: ccc.ScriptLike, scriptType?: "lock" | "type", fromBlock?: bigint): Promise<void>;
  unwatch(script: ccc.ScriptLike, scriptType?: "lock" | "type"): Promise<void>;
}

function defineLightClientClass(
  // Base is a concrete public client (testnet or mainnet, the latter passed via a structural
  // cast since the two share the same shape); a generic base would read as abstract here.
  Base: typeof ccc.ClientPublicTestnet,
): new (opts: LightClientOptions) => ccc.Client & LightClientController {
  return class LightClientCccClientImpl extends Base {
  readonly cfg: NetworkConfig;
  readonly sync = new SyncMachine();
  readonly watches = new WatchList();

  private lc: LightClient | null = null;
  private lcModule: LcModule | null = null;
  private readonly pollIntervalMs: number;
  private readonly logLevel: LightClientOptions["logLevel"];
  private readonly retryPolicy: RetryPolicy;
  private startPromise: Promise<void> | null = null;
  /** Resolves once the workers are up (`lc` assigned); re-armed by stop(). */
  private booted!: Promise<void>;
  private resolveBooted!: () => void;

  // Polling is a setTimeout chain (not setInterval) so the delay can stretch into
  // exponential backoff while the light client is failing, then snap back.
  private polling = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pollFailures = new FailureTracker();
  /** Pending boot-retry sleep, cancelled by stop(). */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelRetrySleep: (() => void) | null = null;

  constructor(opts: LightClientOptions) {
    // Base client still wants a URL; it is never used because every RPC method is overridden.
    super({ url: "light-client://no-rpc" });
    this.cfg = resolveNetwork(opts.network, opts.config);
    this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
    this.logLevel = opts.logLevel ?? "info";
    this.retryPolicy = { ...DEFAULT_RETRY, ...opts.retry };
    this.armBooted();
  }

  private armBooted(): void {
    this.booted = new Promise<void>((resolve) => { this.resolveBooted = resolve; });
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Boot the workers and begin syncing. Idempotent. A failed boot is retried with
   * backoff up to `retry.maxBootAttempts` times (the phase shows `error` with the
   * scheduled retry in between); the promise rejects only after the last attempt.
   */
  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    const p = this.doStart().catch((e) => {
      if (this.startPromise === p) this.startPromise = null;
      throw e;
    });
    this.startPromise = p;
    return p;
  }

  private async doStart(): Promise<void> {
    this.sync.transition("booting", { startedAt: Date.now() });
    for (let attempt = 1; ; attempt++) {
      try {
        await this.boot();
        return;
      } catch (e) {
        const retryable = attempt < this.retryPolicy.maxBootAttempts;
        const delay = backoffDelay(attempt, this.retryPolicy);
        this.sync.fail(
          { code: "BOOT_FAILED", message: String(e), retryable },
          retryable ? { attempt, nextAt: Date.now() + delay } : undefined,
        );
        if (!retryable) throw e;
        const cancelled = await this.sleepForRetry(delay);
        if (cancelled) return; // stop() during the wait
        this.sync.transition("booting");
      }
    }
  }

  /** One boot attempt; leaves nothing running if it throws. */
  private async boot(): Promise<void> {
    const mod = await loadLightClientModule();
    this.lcModule = mod;

    const meta = await loadMeta(this.cfg.dbName);
    const secret = meta?.networkSecretKey ?? mod.randomSecretKey();
    if (meta?.watches) {
      for (const w of WatchList.fromJSON(meta.watches).list()) this.watches.add(w);
    }

    const lc = new mod.LightClient();
    const toml = buildLightClientToml(this.cfg);
    const transport = location.protocol === "https:" ? "wss" : "ws";
    try {
      await lc.start({ type: this.cfg.lcType, config: toml }, secret, this.logLevel, transport);
    } catch (e) {
      await lc.stop().catch(() => {});
      throw e;
    }
    this.lc = lc;
    this.resolveBooted();

    // The light client persists its own sync progress across reloads. Raise each restored
    // watch to the block it has already reached so set_scripts does not rewind and re-scan
    // blocks already synced (a from-scratch rescan is ~600 blocks/s).
    try {
      const synced = await lc.getScripts();
      this.watches.reconcileWith(
        synced.map((x) => ({
          script: x.script,
          scriptType: x.scriptType === "type" ? "type" : "lock",
          blockNumber: BigInt(x.blockNumber),
        })),
      );
    } catch {
      // First boot (or a light client without stored scripts): nothing to reconcile.
    }

    await saveMeta(this.cfg.dbName, { networkSecretKey: secret, watches: this.watches.toJSON() });
    await this.pushScripts();

    this.sync.transition("syncing-headers");
    this.pollFailures.reset();
    this.startPolling();
    await this.tick();
  }

  /** Resolves true if stop() cancelled the wait. */
  private sleepForRetry(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.retryTimer = setTimeout(() => { this.retryTimer = null; this.cancelRetrySleep = null; resolve(false); }, ms);
      this.cancelRetrySleep = () => { if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = null; this.cancelRetrySleep = null; resolve(true); };
    });
  }

  private startPolling(): void {
    this.polling = true;
    this.scheduleTick(this.pollIntervalMs);
  }

  private stopPolling(): void {
    this.polling = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private scheduleTick(ms: number): void {
    if (!this.polling) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.tick();
    }, ms);
  }

  async stop(): Promise<void> {
    this.stopPolling();
    this.cancelRetrySleep?.();
    await this.lc?.stop();
    this.lc = null;
    this.startPromise = null;
    this.armBooted();
  }

  pause(): void {
    this.stopPolling();
    this.sync.transition("paused");
  }

  resume(): void {
    this.sync.transition(this.sync.resumeTarget());
    this.pollFailures.reset();
    this.startPolling();
  }

  /**
   * Retry now instead of waiting for the scheduled backoff: poll immediately when the
   * light client is up, otherwise cancel any pending boot-retry sleep and boot again.
   */
  retry(): void {
    if (this.sync.get().phase !== "error") return;
    if (this.lc) {
      this.polling = true;
      this.scheduleTick(0);
      return;
    }
    this.cancelRetrySleep?.(); // the sleeping doStart returns as "cancelled"
    this.startPromise = null;
    void this.start().catch(() => {});
  }

  /** Stop, wipe IndexedDB for this network, return to idle. */
  async reset(): Promise<void> {
    await this.stop();
    await clearDatabases(this.cfg.dbName);
    this.sync.transition("idle");
  }

  syncState(): SyncState {
    return this.sync.get();
  }

  onSyncState(cb: (s: SyncState) => void): () => void {
    return this.sync.subscribe(cb);
  }

  // ------------------------------------------------------------------ watches

  async watch(script: ccc.ScriptLike, scriptType: "lock" | "type" = "lock", fromBlock?: bigint): Promise<void> {
    // Picking a start block needs the light client's tip, so wait for boot. Hooks
    // commonly call watch() before start() has run (React runs child effects before
    // the provider's); computing "tip" as 0 here would mean a scan from genesis,
    // which runs at roughly 600 blocks/s and never finishes on mainnet.
    if (!this.lc) await this.booted;
    if (!this.lc) throw new Error("light client stopped; call start() before watch()");
    // Counting back from the tip needs a synced tip: right after boot the light
    // client reports block 0, and a start of 0 would be a scan from genesis.
    const needsTip = fromBlock === undefined && this.cfg.watchFromBlock === undefined;
    const tip = needsTip ? await this.tipKnown() : 0n;
    const from = fromBlock ?? resolveWatchStart(tip, this.cfg);
    const changed = this.watches.add({ script, scriptType, fromBlock: from });
    if (changed) await this.pushScripts();
  }

  async unwatch(script: ccc.ScriptLike, scriptType: "lock" | "type" = "lock"): Promise<void> {
    if (this.watches.remove({ script, scriptType })) await this.pushScripts();
  }

  /** Resolves with the header tip once it is known (> 0). */
  private tipKnown(): Promise<bigint> {
    const now = this.sync.get().headerTip;
    if (now > 0n) return Promise.resolve(now);
    return new Promise((resolve) => {
      const unsubscribe = this.sync.subscribe((s) => {
        if (s.headerTip > 0n) { unsubscribe(); resolve(s.headerTip); }
      });
    });
  }

  private async pushScripts(): Promise<void> {
    const mod = this.lcModule;
    if (!this.lc || !mod) return;
    const entries: WatchEntry[] = this.watches.list();
    await this.lc.setScripts(
      entries.map((e) => ({ script: e.script, scriptType: e.scriptType, blockNumber: e.fromBlock })),
      mod.LightClientSetScriptsCommand.All,
    );
    await saveMeta(this.cfg.dbName, { watches: this.watches.toJSON() });
    const phase = this.sync.get().phase;
    if (phase === "ready") this.sync.transition("syncing-cells");
  }

  // --------------------------------------------------------------------- poll

  private async tick(): Promise<void> {
    if (!this.lc) return;
    try {
      const [tip, peers, scripts] = await Promise.all([
        this.lc.getTipHeader(),
        this.lc.getPeers(),
        this.lc.getScripts(),
      ]);
      const headerTip = BigInt(tip.number);
      // Only peers define the network tip. With no peer (or no proved header yet)
      // it stays 0 and the phase remains "syncing-headers": a local checkpoint
      // tip must never be mistaken for a synced chain.
      const networkTip = peers.reduce((m, p) => {
        const n = p.syncState?.provedBestKnownHeader?.number;
        return n !== undefined && BigInt(n) > m ? BigInt(n) : m;
      }, 0n);
      const cellTip = scripts.length === 0 ? headerTip : scripts.reduce((m, s) => (s.blockNumber < m ? s.blockNumber : m), headerTip);

      this.sync.patch({ headerTip, networkTip, cellTip, peers: peers.length });
      const derived = SyncMachine.derive({ headerTip, networkTip, cellTip });
      const cur = this.sync.get().phase;
      // A successful poll also recovers from POLL_FAILED (error → derived phase).
      if (cur !== "paused" && cur !== derived) this.sync.transition(derived);
      this.pollFailures.reset();
      this.scheduleTick(this.pollIntervalMs);
    } catch (e) {
      // Tolerate a few consecutive misses silently (peer churn, a worker call racing a
      // reload); past the threshold surface `error` and back off, but keep polling so
      // the client heals itself as soon as the light client answers again.
      const failures = this.pollFailures.record();
      const over = failures - this.retryPolicy.failuresBeforeError;
      if (over < 0) {
        this.scheduleTick(this.pollIntervalMs);
        return;
      }
      const attempt = over + 1;
      const delay = backoffDelay(attempt, this.retryPolicy);
      this.sync.fail({ code: "POLL_FAILED", message: String(e), retryable: true }, { attempt, nextAt: Date.now() + delay });
      this.scheduleTick(delay);
    }
  }

  private need(): LightClient {
    if (!this.lc) throw new Error("light client not started; call start() first");
    return this.lc;
  }

  // ---------------------------------------------------- ccc.Client overrides
  // Each override maps a JSON-RPC-backed member to the light client equivalent.
  // Members without a light-client equivalent throw a clear error (see design doc §6).

  override getTip = async (): Promise<ccc.Num> => {
    return BigInt((await this.need().getTipHeader()).number);
  };

  override getTipHeader = async (): Promise<ccc.ClientBlockHeader> => {
    return (await this.need().getTipHeader()) as unknown as ccc.ClientBlockHeader;
  };

  override getHeaderByHashNoCache = async (hash: ccc.HexLike): Promise<ccc.ClientBlockHeader | undefined> => {
    return (await this.need().getHeader(hash)) as unknown as ccc.ClientBlockHeader | undefined;
  };

  override getHeaderByNumberNoCache = async (): Promise<ccc.ClientBlockHeader | undefined> => {
    throw unsupported("getHeaderByNumber");
  };

  override getBlockByHashNoCache = async (): Promise<ccc.ClientBlock | undefined> => {
    throw unsupported("getBlockByHash");
  };

  override getBlockByNumberNoCache = async (): Promise<ccc.ClientBlock | undefined> => {
    throw unsupported("getBlockByNumber");
  };

  override sendTransactionNoCache = async (tx: ccc.TransactionLike): Promise<ccc.Hex> => {
    if (this.sync.get().phase !== "ready") {
      throw Object.assign(new Error("light client not synced"), { code: "NOT_SYNCED" });
    }
    return this.need().sendTransaction(toLcTx(tx));
  };

  override sendTransactionDry = async (tx: ccc.TransactionLike): Promise<ccc.Num> => {
    return this.need().estimateCycles(toLcTx(tx));
  };

  override getTransactionNoCache = async (txHash: ccc.HexLike): Promise<ccc.ClientTransactionResponse | undefined> => {
    const r = await this.need().getTransaction(txHash);
    return r as unknown as ccc.ClientTransactionResponse | undefined;
  };

  override findCellsPagedNoCache = async (
    key: ccc.ClientIndexerSearchKeyLike,
    order?: "asc" | "desc",
    limit?: ccc.NumLike,
    after?: string,
  ): Promise<ccc.ClientFindCellsResponse> => {
    const r = await this.need().getCells(key, order, limit, after as ccc.Hex | undefined);
    return r as unknown as ccc.ClientFindCellsResponse;
  };

  /**
   * The light client has no `get_live_cell`; resolve the cell through the
   * transaction that created it (known for every watched script). Liveness is
   * not re-verified, which is fine for CCC's cache fallback on known inputs.
   */
  override async getCellLiveNoCache(
    outPointLike: ccc.OutPointLike,
    withData?: boolean | null,
  ): Promise<ccc.Cell | undefined> {
    const outPoint = ccc.OutPoint.from(outPointLike);
    const res = await this.getTransactionNoCache(outPoint.txHash);
    if (!res) return undefined;
    const index = Number(outPoint.index);
    const cellOutput = res.transaction.outputs[index];
    if (!cellOutput) return undefined;
    const outputData = withData ? (res.transaction.outputsData[index] ?? "0x") : "0x";
    const cell = ccc.Cell.from({ outPoint, cellOutput, outputData });

    // The transaction that created the cell proves it existed, not that it is still unspent.
    // For a watched script the light client's get_cells returns only live cells, so we can
    // tell: a spent cell (e.g. a stale input the caller is trying to reuse) returns undefined
    // instead of a cell that would be rejected at broadcast. For unwatched scripts we cannot
    // check, so we return the reconstructed cell (best effort), which is what CCC's cache
    // fallback expects for resolving an arbitrary out point.
    if (await this.isKnownSpent(cellOutput, outPoint)) return undefined;
    return cell;
  }

  /**
   * True only when the cell's lock or type is watched AND the light client's live set does
   * not contain this out point (i.e. it is known to be spent). false = watched and live.
   * undefined = cannot determine (unwatched, or too many cells to scan) → treated as live.
   */
  private async isKnownSpent(cellOutput: ccc.CellOutput, outPoint: ccc.OutPoint): Promise<boolean> {
    const lc = this.lc;
    if (!lc) return false;
    let script: ccc.Script | undefined;
    let scriptType: "lock" | "type" | undefined;
    if (this.watches.has({ script: cellOutput.lock, scriptType: "lock" })) {
      script = cellOutput.lock;
      scriptType = "lock";
    } else if (cellOutput.type && this.watches.has({ script: cellOutput.type, scriptType: "type" })) {
      script = cellOutput.type;
      scriptType = "type";
    }
    if (!script || !scriptType) return false; // not watched → cannot tell, treat as live

    const MAX_PAGES = 5;
    const PAGE = 1000n;
    let after: ccc.Hex | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await lc.getCells(
        { script, scriptType, scriptSearchMode: "exact", withData: false },
        "asc",
        PAGE,
        after,
      );
      for (const c of page.cells) {
        const op = ccc.OutPoint.from(c.outPoint);
        if (op.txHash === outPoint.txHash && op.index === outPoint.index) return false; // found → live
      }
      if (BigInt(page.cells.length) < PAGE || !page.lastCursor) return true; // exhausted, not found → spent
      after = page.lastCursor as ccc.Hex;
    }
    return false; // too many cells to scan confidently → do not block
  }

  override getCellsCapacity = async (key: ccc.ClientIndexerSearchKeyLike): Promise<ccc.Num> => {
    return this.need().getCellsCapacity(key);
  };

  override estimateCycles = async (tx: ccc.TransactionLike): Promise<ccc.Num> => {
    return this.need().estimateCycles(toLcTx(tx));
  };

  /** No fee statistics without a full node; return the configured default. */
  override getFeeRateStatistics = async (): Promise<{ mean: ccc.Num; median: ccc.Num }> => {
    return { mean: this.cfg.defaultFeeRate, median: this.cfg.defaultFeeRate };
  };
  };
}

const LightClientCccClientTestnet = defineLightClientClass(ccc.ClientPublicTestnet);
const LightClientCccClientMainnet = defineLightClientClass(ccc.ClientPublicMainnet as unknown as typeof ccc.ClientPublicTestnet);

/** The light-client-backed ccc.Client; both networks share this shape. */
export type LightClientCccClient = ccc.Client & LightClientController;

/** Create a light-client-backed client on the CCC base class matching the network. */
export function createLightClientCccClient(opts: LightClientOptions): LightClientCccClient {
  const Cls = opts.network === "mainnet" ? LightClientCccClientMainnet : LightClientCccClientTestnet;
  return new Cls(opts) as unknown as LightClientCccClient;
}

/** Transaction type expected by the bundled light client (its own CCC alpha). */
type LcTransactionLike = Parameters<LightClient["sendTransaction"]>[0];

function toLcTx(tx: ccc.TransactionLike): LcTransactionLike {
  return ccc.Transaction.from(tx) as unknown as LcTransactionLike;
}

function unsupported(method: string): Error {
  return Object.assign(
    new Error(`${method} is not available on a light client (no full-node RPC)`),
    { code: "UNSUPPORTED" },
  );
}
