import { ccc } from "@ckb-ccc/core";
import { LightClient, LightClientSetScriptsCommand, randomSecretKey } from "ckb-light-client-js";
import { buildLightClientToml, resolveNetwork, resolveWatchStart, type NetworkConfig, type NetworkName } from "./config.js";
import { SyncMachine, type SyncState } from "./sync.js";
import { WatchList, type WatchEntry } from "./watch.js";
import { loadMeta, saveMeta, clearDatabases } from "./storage.js";

export interface LightClientOptions {
  network: NetworkName;
  /** Override bootnodes, db name, fee rate, watch depth. */
  config?: Partial<NetworkConfig>;
  /** Poll interval for tips/peers in ms. */
  pollIntervalMs?: number;
  logLevel?: "trace" | "debug" | "info" | "error";
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
export class LightClientCccClient extends ccc.ClientPublicTestnet {
  readonly cfg: NetworkConfig;
  readonly sync = new SyncMachine();
  readonly watches = new WatchList();

  private lc: LightClient | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;
  private readonly logLevel: LightClientOptions["logLevel"];
  private startPromise: Promise<void> | null = null;
  /** Resolves once the workers are up (`lc` assigned); re-armed by stop(). */
  private booted!: Promise<void>;
  private resolveBooted!: () => void;

  constructor(opts: LightClientOptions) {
    // Base client still wants a URL; it is never used because every RPC method is overridden.
    super({ url: "light-client://no-rpc" });
    this.cfg = resolveNetwork(opts.network, opts.config);
    this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
    this.logLevel = opts.logLevel ?? "info";
    this.armBooted();
  }

  private armBooted(): void {
    this.booted = new Promise<void>((resolve) => { this.resolveBooted = resolve; });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Boot the workers and begin syncing. Idempotent. */
  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.doStart().catch((e) => {
      this.sync.fail({ code: "BOOT_FAILED", message: String(e), retryable: true });
      this.startPromise = null;
      throw e;
    });
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    this.sync.transition("booting", { startedAt: Date.now() });

    const meta = await loadMeta(this.cfg.dbName);
    const secret = meta?.networkSecretKey ?? randomSecretKey();
    if (meta?.watches) {
      for (const w of WatchList.fromJSON(meta.watches).list()) this.watches.add(w);
    }

    const lc = new LightClient();
    const toml = buildLightClientToml(this.cfg);
    const transport = location.protocol === "https:" ? "wss" : "ws";
    await lc.start({ type: this.cfg.lcType, config: toml }, secret, this.logLevel, transport);
    this.lc = lc;
    this.resolveBooted();

    await saveMeta(this.cfg.dbName, { networkSecretKey: secret, watches: this.watches.toJSON() });
    await this.pushScripts();

    this.sync.transition("syncing-headers");
    this.pollTimer = setInterval(() => void this.tick(), this.pollIntervalMs);
    await this.tick();
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    await this.lc?.stop();
    this.lc = null;
    this.startPromise = null;
    this.armBooted();
  }

  pause(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.sync.transition("paused");
  }

  resume(): void {
    this.sync.transition(this.sync.resumeTarget());
    this.pollTimer = setInterval(() => void this.tick(), this.pollIntervalMs);
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
    if (!this.lc) return;
    const entries: WatchEntry[] = this.watches.list();
    await this.lc.setScripts(
      entries.map((e) => ({ script: e.script, scriptType: e.scriptType, blockNumber: e.fromBlock })),
      LightClientSetScriptsCommand.All,
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
      if (cur !== "paused" && cur !== derived) this.sync.transition(derived);
    } catch (e) {
      this.sync.fail({ code: "POLL_FAILED", message: String(e), retryable: true });
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
    return ccc.Cell.from({ outPoint, cellOutput, outputData });
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
