/**
 * Stand-in for `@light-dapp-kit/core` in hook tests: the same surface the provider and
 * hooks touch, with no workers, no IndexedDB and no network. Tests drive it directly
 * (`setSync`, `cells`, `capacity`, ...) and inspect the calls it recorded.
 */
import { ccc } from "@ckb-ccc/core";
import type { SyncState } from "@light-dapp-kit/core";

export const DAO_SCRIPT = { codeHash: "0x" + "82".repeat(32), hashType: "type" as const };

export class FakeLightClient {
  readonly cfg: Record<string, unknown>;
  readonly addressPrefix = "ckt";
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  started = 0;
  stopped = 0;
  retried = 0;
  capacity = 0n;
  cells: unknown[] = [];
  lastCursor = "0x";
  txResponses: Array<{ status: string } | undefined> = [];
  sendResult: string | Error = "0x" + "ab".repeat(32);
  private state: SyncState = { phase: "ready", headerTip: 100n, networkTip: 100n, cellTip: 100n, peers: 3, startedAt: 0 };
  private listeners = new Set<(s: SyncState) => void>();

  constructor(opts: { network: string; config?: Record<string, unknown> }) {
    this.cfg = { network: opts.network, ...opts.config };
    instances.push(this);
  }

  // --- test controls
  setSync(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const cb of this.listeners) cb(this.state);
  }
  callsTo(method: string) { return this.calls.filter((c) => c.method === method); }
  private record(method: string, ...args: unknown[]) { this.calls.push({ method, args }); }

  // --- surface used by provider + hooks
  syncState(): SyncState { return this.state; }
  onSyncState(cb: (s: SyncState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => { this.listeners.delete(cb); };
  }
  async start(): Promise<void> { this.started++; this.record("start"); }
  async stop(): Promise<void> { this.stopped++; this.record("stop"); }
  pause(): void { this.record("pause"); }
  resume(): void { this.record("resume"); }
  async reset(): Promise<void> { this.record("reset"); }
  retry(): void { this.retried++; this.record("retry"); }
  async watch(script: ccc.ScriptLike, scriptType: "lock" | "type" = "lock", fromBlock?: bigint): Promise<void> {
    this.record("watch", script, scriptType, fromBlock);
  }
  async getCellsCapacity(key: unknown): Promise<bigint> { this.record("getCellsCapacity", key); return this.capacity; }
  async findCellsPagedNoCache(key: unknown, order?: string, limit?: bigint, after?: string) {
    this.record("findCellsPagedNoCache", key, order, limit, after);
    return { cells: this.cells, lastCursor: this.lastCursor };
  }
  async getKnownScript(_s: unknown) { this.record("getKnownScript", _s); return { ...DAO_SCRIPT, cellDeps: [] }; }
  async sendTransactionNoCache(tx: unknown): Promise<string> {
    this.record("sendTransactionNoCache", tx);
    if (this.sendResult instanceof Error) throw this.sendResult;
    return this.sendResult;
  }
  async getTransactionNoCache(hash: string) {
    this.record("getTransactionNoCache", hash);
    return this.txResponses.shift();
  }
}

export const instances: FakeLightClient[] = [];
export function lastClient(): FakeLightClient {
  const c = instances[instances.length - 1];
  if (!c) throw new Error("no FakeLightClient has been constructed");
  return c;
}
export function resetInstances(): void { instances.length = 0; }

// What the provider imports by value from the real package.
export { FakeLightClient as LightClientCccClient };
