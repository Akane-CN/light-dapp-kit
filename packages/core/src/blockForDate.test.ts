import { describe, expect, it } from "vitest";
import { estimateBlockForDate } from "./blockForDate.js";

// 2,000,000 blocks spanning exactly 200,000,000 ms → 100 ms per block, linear.
const genesis = { number: 0n, timestamp: 1_000_000n };
const tip = { number: 2_000_000n, timestamp: 201_000_000n };

describe("estimateBlockForDate", () => {
  it("interpolates a mid-chain date", () => {
    // halfway in time → halfway in blocks
    expect(estimateBlockForDate({ genesis, tip, targetMs: 101_000_000n })).toBe(1_000_000n);
  });

  it("clamps dates at or before genesis to the genesis block", () => {
    expect(estimateBlockForDate({ genesis, tip, targetMs: 1_000_000n })).toBe(0n);
    expect(estimateBlockForDate({ genesis, tip, targetMs: 0n })).toBe(0n);
  });

  it("clamps dates at or after the tip to the tip block", () => {
    expect(estimateBlockForDate({ genesis, tip, targetMs: 201_000_000n })).toBe(2_000_000n);
    expect(estimateBlockForDate({ genesis, tip, targetMs: 999_000_000n })).toBe(2_000_000n);
  });

  it("subtracts the safety margin and never goes below genesis", () => {
    expect(estimateBlockForDate({ genesis, tip, targetMs: 101_000_000n, safetyBlocks: 50_000n })).toBe(950_000n);
    expect(estimateBlockForDate({ genesis, tip, targetMs: 1_100_000n, safetyBlocks: 50_000n })).toBe(0n);
  });

  it("floors (biases earlier) rather than rounding", () => {
    // 100.9 ms worth → block 1009 before margin; exact floor of 100_900 ms offset
    expect(estimateBlockForDate({ genesis, tip, targetMs: 1_000_000n + 100_949n })).toBe(1009n);
  });

  it("falls back to genesis when the chain has no span yet", () => {
    const flat = { number: 0n, timestamp: 1_000_000n };
    expect(estimateBlockForDate({ genesis: flat, tip: flat, targetMs: 5_000_000n })).toBe(0n);
  });
});
