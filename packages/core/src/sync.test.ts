import { describe, expect, it } from "vitest";
import { SyncMachine } from "./sync.js";
import { WatchList } from "./watch.js";
import { resolveWatchStart } from "./config.js";

describe("SyncMachine", () => {
  it("walks the happy path", () => {
    const m = new SyncMachine();
    m.transition("booting");
    m.transition("syncing-headers");
    m.transition("syncing-cells");
    m.transition("ready");
    expect(m.get().phase).toBe("ready");
  });

  it("rejects illegal transitions", () => {
    const m = new SyncMachine();
    expect(() => m.transition("ready")).toThrow(/illegal/);
  });

  it("pause remembers where to resume", () => {
    const m = new SyncMachine();
    m.transition("booting");
    m.transition("syncing-headers");
    m.transition("syncing-cells");
    m.transition("paused");
    expect(m.resumeTarget()).toBe("syncing-cells");
  });

  it("reaches ready straight from syncing-headers when nothing is watched", () => {
    const m = new SyncMachine();
    m.transition("booting");
    m.transition("syncing-headers");
    m.transition("ready");
    expect(m.get().phase).toBe("ready");
  });

  it("derives phase from tips", () => {
    expect(SyncMachine.derive({ headerTip: 10n, networkTip: 100n, cellTip: 0n })).toBe("syncing-headers");
    expect(SyncMachine.derive({ headerTip: 100n, networkTip: 100n, cellTip: 50n })).toBe("syncing-cells");
    expect(SyncMachine.derive({ headerTip: 100n, networkTip: 101n, cellTip: 99n })).toBe("ready");
    // No peer has reported a tip yet: never "ready" on the local checkpoint alone.
    expect(SyncMachine.derive({ headerTip: 100n, networkTip: 0n, cellTip: 100n })).toBe("syncing-headers");
  });
});

describe("WatchList", () => {
  const lock = { codeHash: "0x01", hashType: "type", args: "0xaa" };
  it("dedupes and keeps the earliest fromBlock", () => {
    const w = new WatchList();
    expect(w.add({ script: lock, scriptType: "lock", fromBlock: 100n })).toBe(true);
    expect(w.add({ script: lock, scriptType: "lock", fromBlock: 200n })).toBe(false);
    expect(w.add({ script: lock, scriptType: "lock", fromBlock: 50n })).toBe(true);
    expect(w.minFromBlock()).toBe(50n);
    expect(w.list()).toHaveLength(1);
  });
  it("round-trips JSON", () => {
    const w = new WatchList([{ script: lock, scriptType: "lock", fromBlock: 7n }]);
    expect(WatchList.fromJSON(w.toJSON()).minFromBlock()).toBe(7n);
  });
});

describe("resolveWatchStart", () => {
  it("uses an explicit start block even when the tip is not known yet", () => {
    expect(resolveWatchStart(0n, { watchFromBlock: 22888142n, defaultWatchDepth: 1000n })).toBe(22888142n);
    expect(resolveWatchStart(5n, { watchFromBlock: 22888142n, defaultWatchDepth: 1000n })).toBe(22888142n);
  });
  it("counts the default depth back from the tip, never below 0", () => {
    expect(resolveWatchStart(5000n, { defaultWatchDepth: 1000n })).toBe(4000n);
    expect(resolveWatchStart(500n, { defaultWatchDepth: 1000n })).toBe(0n);
  });
});

describe("SyncMachine recovery", () => {
  it("records the scheduled retry on fail and clears it when leaving error", () => {
    const m = new SyncMachine();
    m.transition("booting");
    m.fail({ code: "BOOT_FAILED", message: "x", retryable: true }, { attempt: 1, nextAt: 123 });
    expect(m.get().phase).toBe("error");
    expect(m.get().retry).toEqual({ attempt: 1, nextAt: 123 });
    m.transition("booting");
    expect(m.get().error).toBeUndefined();
    expect(m.get().retry).toBeUndefined();
  });
  it("lets a successful poll leave error straight for the derived phase", () => {
    const m = new SyncMachine();
    m.transition("booting");
    m.transition("syncing-headers");
    m.fail({ code: "POLL_FAILED", message: "peer timeout", retryable: true });
    m.transition("ready");
    expect(m.get().phase).toBe("ready");
  });
  it("still returns to idle through reset", () => {
    const m = new SyncMachine();
    m.transition("booting");
    m.fail({ code: "BOOT_FAILED", message: "x", retryable: false });
    m.transition("idle");
    expect(m.get().phase).toBe("idle");
  });
});

describe("WatchList reconcileWith", () => {
  const lock = { codeHash: "0x" + "01".repeat(32), hashType: "type", args: "0xaa" };
  const type = { codeHash: "0x" + "02".repeat(32), hashType: "type", args: "0xbb" };
  it("raises an entry to the light client's synced block, never lowering it", () => {
    const w = new WatchList([{ script: lock, scriptType: "lock", fromBlock: 1000n }]);
    const changed = w.reconcileWith([{ script: lock, scriptType: "lock", blockNumber: 22888000n }]);
    expect(changed).toBe(true);
    expect(w.minFromBlock()).toBe(22888000n);
  });
  it("does not lower an entry already ahead of the synced block", () => {
    const w = new WatchList([{ script: lock, scriptType: "lock", fromBlock: 22888000n }]);
    const changed = w.reconcileWith([{ script: lock, scriptType: "lock", blockNumber: 1000n }]);
    expect(changed).toBe(false);
    expect(w.minFromBlock()).toBe(22888000n);
  });
  it("matches by script + scriptType and ignores unrelated synced scripts", () => {
    const w = new WatchList([
      { script: lock, scriptType: "lock", fromBlock: 10n },
      { script: type, scriptType: "type", fromBlock: 10n },
    ]);
    w.reconcileWith([
      { script: lock, scriptType: "lock", blockNumber: 500n },
      { script: { ...lock, args: "0xff" }, scriptType: "lock", blockNumber: 9_000_000n },
    ]);
    const byArgs = Object.fromEntries(w.list().map((e) => [(e.script as { args: string }).args, e.fromBlock]));
    expect(byArgs["0xaa"]).toBe(500n);
    expect(byArgs["0xbb"]).toBe(10n);
  });
});
