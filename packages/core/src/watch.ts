import { ccc, type ScriptLike } from "@ckb-ccc/core";

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

/** A script already synced by the light client (shape of its getScripts() entries). */
export interface SyncedScript {
  script: ScriptLike;
  scriptType: string;
  blockNumber: bigint;
}

// Normalize through ccc.Script so a script restored from storage and the same script
// returned by the light client key identically (hashType "type" vs 0x01, casing, 0x).
const key = (e: Pick<WatchEntry, "script" | "scriptType">): string => {
  const s = ccc.Script.from(e.script);
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

  /** The key used to dedupe entries; exposed so callers can match external script lists. */
  static keyOf(e: Pick<WatchEntry, "script" | "scriptType">): string {
    return key(e);
  }

  /**
   * Raise entries to the block the light client has already synced them to, so a reload
   * never rewinds set_scripts and re-scans blocks the light client already has. Only
   * raises (never lowers) each entry's fromBlock. Returns true if anything changed.
   */
  reconcileWith(synced: SyncedScript[]): boolean {
    const byKey = new Map<string, bigint>();
    for (const s of synced) {
      const k = key({ script: s.script, scriptType: s.scriptType === "type" ? "type" : "lock" });
      const prev = byKey.get(k);
      if (prev === undefined || s.blockNumber > prev) byKey.set(k, s.blockNumber);
    }
    let changed = false;
    for (const [k, entry] of this.entries) {
      const at = byKey.get(k);
      if (at !== undefined && at > entry.fromBlock) {
        this.entries.set(k, { ...entry, fromBlock: at });
        changed = true;
      }
    }
    return changed;
  }

  toJSON(): Array<Omit<WatchEntry, "fromBlock"> & { fromBlock: string }> {
    return this.list().map((e) => ({ ...e, fromBlock: e.fromBlock.toString() }));
  }

  static fromJSON(raw: ReturnType<WatchList["toJSON"]>): WatchList {
    return new WatchList(raw.map((e) => ({ ...e, fromBlock: BigInt(e.fromBlock) })));
  }
}
