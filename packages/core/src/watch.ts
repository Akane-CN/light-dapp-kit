import type { ScriptLike } from "@ckb-ccc/core";

/**
 * The light client's set_scripts is *replace-all*, not incremental.
 * WatchList keeps the full set so every change re-submits the complete list.
 * Persisted to IndexedDB (`light-dapp-kit-meta`) so a reload re-registers scripts.
 */
export interface WatchEntry {
  script: ScriptLike;
  scriptType: "lock" | "type";
  fromBlock: bigint;
}

const key = (e: Pick<WatchEntry, "script" | "scriptType">): string => {
  const s = e.script as { codeHash: string; hashType: string; args: string };
  return `${e.scriptType}:${s.codeHash}:${s.hashType}:${s.args}`;
};

export class WatchList {
  private entries = new Map<string, WatchEntry>();

  constructor(initial: WatchEntry[] = []) {
    for (const e of initial) this.entries.set(key(e), e);
  }

  add(entry: WatchEntry): boolean {
    const k = key(entry);
    const existing = this.entries.get(k);
    if (existing) {
      // Keep the earliest fromBlock so we never skip blocks.
      if (entry.fromBlock < existing.fromBlock) {
        this.entries.set(k, { ...existing, fromBlock: entry.fromBlock });
        return true;
      }
      return false;
    }
    this.entries.set(k, entry);
    return true;
  }

  remove(entry: Pick<WatchEntry, "script" | "scriptType">): boolean {
    return this.entries.delete(key(entry));
  }

  has(entry: Pick<WatchEntry, "script" | "scriptType">): boolean {
    return this.entries.has(key(entry));
  }

  list(): WatchEntry[] {
    return [...this.entries.values()];
  }

  /** Minimum fromBlock across all entries; what set_scripts should start from. */
  minFromBlock(): bigint | undefined {
    let min: bigint | undefined;
    for (const e of this.entries.values()) {
      if (min === undefined || e.fromBlock < min) min = e.fromBlock;
    }
    return min;
  }

  toJSON(): Array<Omit<WatchEntry, "fromBlock"> & { fromBlock: string }> {
    return this.list().map((e) => ({ ...e, fromBlock: e.fromBlock.toString() }));
  }

  static fromJSON(raw: ReturnType<WatchList["toJSON"]>): WatchList {
    return new WatchList(raw.map((e) => ({ ...e, fromBlock: BigInt(e.fromBlock) })));
  }
}
