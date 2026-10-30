/**
 * Sync state machine. Mirrors design doc §5.
 *
 * idle → booting → syncing-headers → syncing-cells → ready
 * (syncing-headers → ready directly when no script is watched)
 *                        ↘ error ↙      ⇅ paused
 * ready → syncing-cells on new block / new watch, then back.
 * error → booting (boot retry) or → a sync phase (a poll succeeded again); the
 * client retries retryable errors on its own with backoff. error → idle via reset().
 */
export type SyncPhase =
  | "idle"
  | "booting"
  | "syncing-headers"
  | "syncing-cells"
  | "ready"
  | "paused"
  | "error";

export interface SyncError {
  code: string;
  message: string;
  retryable: boolean;
}

/** Scheduled automatic retry while in `error`. */
export interface SyncRetry {
  /** 1-based retry attempt about to run. */
  attempt: number;
  /** Epoch ms when the retry fires. */
  nextAt: number;
}

export interface SyncState {
  phase: SyncPhase;
  headerTip: bigint;
  networkTip: bigint;
  cellTip: bigint;
  peers: number;
  startedAt: number;
  error?: SyncError;
  retry?: SyncRetry;
}

type Listener = (s: SyncState) => void;

// `idle` is reachable from everywhere: reset() must always be legal.
const TRANSITIONS: Record<SyncPhase, SyncPhase[]> = {
  idle: ["booting"],
  booting: ["syncing-headers", "error", "idle"],
  // Straight to ready when nothing is watched yet (no cells to index).
  "syncing-headers": ["syncing-cells", "ready", "paused", "error", "idle"],
  "syncing-cells": ["ready", "syncing-headers", "paused", "error", "idle"],
  ready: ["syncing-cells", "paused", "error", "idle"],
  paused: ["syncing-headers", "syncing-cells", "ready", "error", "idle"],
  // Recovery: a boot retry goes through booting again; a poll that succeeds after
  // POLL_FAILED jumps straight to whatever the tips say.
  error: ["idle", "booting", "syncing-headers", "syncing-cells", "ready"],
};

export class SyncMachine {
  private state: SyncState = {
    phase: "idle",
    headerTip: 0n,
    networkTip: 0n,
    cellTip: 0n,
    peers: 0,
    startedAt: 0,
  };
  private listeners = new Set<Listener>();
  private phaseBeforePause: SyncPhase = "syncing-headers";

  get(): SyncState {
    return this.state;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => this.listeners.delete(cb);
  }

  /** Transition to `next`; throws on an illegal transition so bugs surface in tests. */
  transition(next: SyncPhase, patch: Partial<SyncState> = {}): void {
    const from = this.state.phase;
    if (!TRANSITIONS[from].includes(next)) {
      throw new Error(`illegal sync transition ${from} → ${next}`);
    }
    if (next === "paused") this.phaseBeforePause = from;
    this.state = { ...this.state, ...patch, phase: next };
    if (next !== "error") { this.state.error = undefined; this.state.retry = undefined; }
    this.emit();
  }

  /** Update numeric fields without changing phase. */
  patch(patch: Partial<Omit<SyncState, "phase">>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /** Enter `error`. `retry` describes the automatic retry the client has scheduled, if any. */
  fail(error: SyncError, retry?: SyncRetry): void {
    this.state = { ...this.state, phase: "error", error, retry };
    this.emit();
  }

  resumeTarget(): SyncPhase {
    return this.phaseBeforePause === "paused" ? "syncing-headers" : this.phaseBeforePause;
  }

  /** Derive the phase from tips: used after each poll tick. */
  static derive(s: Pick<SyncState, "headerTip" | "networkTip" | "cellTip">): SyncPhase {
    if (s.networkTip === 0n) return "syncing-headers";
    if (s.headerTip + 2n < s.networkTip) return "syncing-headers";
    if (s.cellTip + 2n < s.headerTip) return "syncing-cells";
    return "ready";
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.state);
  }
}
