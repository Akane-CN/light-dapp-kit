import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY, FailureTracker, backoffDelay } from "./retry.js";

describe("backoffDelay", () => {
  const p = { baseDelayMs: 2_000, maxDelayMs: 60_000 };
  it("doubles from the base delay", () => {
    expect(backoffDelay(1, p)).toBe(2_000);
    expect(backoffDelay(2, p)).toBe(4_000);
    expect(backoffDelay(3, p)).toBe(8_000);
  });
  it("is capped at maxDelayMs", () => {
    expect(backoffDelay(10, p)).toBe(60_000);
    expect(backoffDelay(100, p)).toBe(60_000);
  });
  it("treats attempts below 1 as the first attempt", () => {
    expect(backoffDelay(0, p)).toBe(2_000);
    expect(backoffDelay(-5, p)).toBe(2_000);
  });
  it("defaults reach the cap after a handful of failures", () => {
    expect(backoffDelay(6, DEFAULT_RETRY)).toBe(60_000);
  });
});

describe("FailureTracker", () => {
  it("counts consecutive failures and resets on success", () => {
    const t = new FailureTracker();
    expect(t.consecutive).toBe(0);
    expect(t.record()).toBe(1);
    expect(t.record()).toBe(2);
    t.reset();
    expect(t.consecutive).toBe(0);
    expect(t.record()).toBe(1);
  });
});
