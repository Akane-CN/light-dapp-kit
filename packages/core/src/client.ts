import { ccc } from "@ckb-ccc/core";
import { LightClient, randomSecretKey } from "ckb-light-client-js";
import { buildLightClientToml, resolveNetwork, type NetworkConfig, type NetworkName } from "./config.js";
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
 * NOTE(M1): method names/signatures below target @ckb-ccc/core 1.x. Verify each
 * override against the installed version with `bun run typecheck`; the adapter
 * contract test (client.test.ts) must cover every overridden method.
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

  constructor(opts: LightClientOptions) {
    // Base client still wants a URL; it is never used because every RPC method is overridden.
    super({ url: "light-client://no-rpc" });
    this.cfg = resolveNetwork(opts.network, opts.config);
    this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
    this.logLevel = opts.logLevel ?? "info";
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
    const tip = this.sync.get().headerTip;
    const from = fromBlock ?? (tip > this.cfg.defaultWatchDepth ? tip - this.cfg.defaultWatchDepth : 0n);
    const changed = this.watches.add({ script, scriptType, fromBlock: from });
    if (changed) await this.pushScripts();
  }

  async unwatch(script: ccc.ScriptLike, scriptType: "lock" | "type" = "lock"): Promise<void> {
    if (this.watches.remove({ script, scriptType })) await this.pushScripts();
  }

  private async pushScripts(): Promise<void> {
    if (!this.lc) return;
    const entries: WatchEntry[] = this.watches.list();
    await this.lc.setScripts(
      entries.map((e) => ({ script: e.script, scriptType: e.scriptType, blockNumber: e.fromBlock })),
      "all",
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
      const networkTip = peers.reduce((m, p) => {
        const n = p.syncState?.provedBestKnownHeader?.number;
        return n !== undefined && BigInt(n) > m ? BigInt(n) : m;
      }, headerTip);
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
  // Each override maps a JSON-RPC-backed method to the light client equivalent.
  // Methods without a light-client equivalent throw a clear error (see design doc §6).

  override async getTip(): Promise<ccc.Num> {
    return BigInt((await this.need().getTipHeader()).number);
  }

  override async getTipHeader(): Promise<ccc.ClientBlockHeader> {
    return (await this.need().getTipHeader()) as unknown as ccc.ClientBlockHeader;
  }

  override async getHeaderByHashNoCache(hash: ccc.HexLike): Promise<ccc.ClientBlockHeader | undefined> {
    return (await this.need().getHeader(hash)) as unknown as ccc.ClientBlockHeader | undefined;
  }

  override async sendTransactionNoCache(tx: ccc.TransactionLike): Promise<ccc.Hex> {
    if (this.sync.get().phase !== "ready") {
      throw Object.assign(new Error("light client not synced"), { code: "NOT_SYNCED" });
    }
    return this.need().sendTransaction(tx);
  }

  override async getTransactionNoCache(txHash: ccc.HexLike): Promise<ccc.ClientTransactionResponse | undefined> {
    const r = await this.need().getTransaction(txHash);
    return r as unknown as ccc.ClientTransactionResponse | undefined;
  }

  override async findCellsPagedNoCache(
    key: ccc.ClientIndexerSearchKeyLike,
    order?: "asc" | "desc",
    limit?: ccc.NumLike,
    after?: ccc.Hex,
  ): Promise<ccc.ClientFindCellsResponse> {
    const r = await this.need().getCells(key, order, limit, after);
    return r as unknown as ccc.ClientFindCellsResponse;
  }

  override async getCellsCapacity(key: ccc.ClientIndexerSearchKeyLike): Promise<ccc.Num> {
    return this.need().getCellsCapacity(key);
  }

  override async estimateCycles(tx: ccc.TransactionLike): Promise<ccc.Num> {
    return this.need().estimateCycles(tx);
  }

  /** No fee statistics without a full node; return the configured default. */
  override async getFeeRateStatistics(): Promise<{ mean: ccc.Num; median: ccc.Num }> {
    return { mean: this.cfg.defaultFeeRate, median: this.cfg.defaultFeeRate };
  }
}
