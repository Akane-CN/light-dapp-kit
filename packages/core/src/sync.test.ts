import { describe, expect, it } from "vitest";
import { SyncMachine } from "./sync.js";
import { WatchList } from "./watch.js";

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
