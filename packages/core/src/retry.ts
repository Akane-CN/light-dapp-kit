/**
 * Retry policy for the light client's boot and poll loops.
 *
 * Transient failures (a peer timing out, a worker call racing a reload) are far more
 * common than fatal ones, so the client never parks itself in `error` after a single
 * miss. It counts consecutive failures, reports `error` with a scheduled retry once the
 * threshold is reached, and keeps retrying with exponential backoff until a call succeeds.
 */
export interface RetryPolicy {
  /** Consecutive poll failures tolerated silently before the phase becomes `error`. */
  failuresBeforeError: number;
  /** First retry delay; doubles on every further failure. */
  baseDelayMs: number;
  /** Upper bound for the backoff delay. */
  maxDelayMs: number;
  /** Boot attempts before giving up (`start()` rejects after the last one). */
  maxBootAttempts: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  failuresBeforeError: 3,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  maxBootAttempts: 5,
};

/** Delay before retry number `attempt` (1-based): base × 2^(attempt−1), capped. */
export function backoffDelay(attempt: number, policy: Pick<RetryPolicy, "baseDelayMs" | "maxDelayMs">): number {
  const n = Math.max(1, Math.floor(attempt));
  const delay = policy.baseDelayMs * 2 ** (n - 1);
  return Math.min(delay, policy.maxDelayMs);
}

/** Counts consecutive failures; `record()` returns the new count, `reset()` on success. */
export class FailureTracker {
  private count = 0;

  get consecutive(): number {
    return this.count;
  }

  record(): number {
    this.count += 1;
    return this.count;
  }

  reset(): void {
    this.count = 0;
  }
}
