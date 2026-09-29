/**
 * Sync state machine. Mirrors design doc §5.
 *
 * idle → booting → syncing-headers → syncing-cells → ready
 *                        ↘ error ↙      ⇅ paused
 * ready → syncing-cells on new block / new watch, then back.
 * error → idle only via reset().
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

export interface SyncState {
  phase: SyncPhase;
  headerTip: bigint;
  networkTip: bigint;
  cellTip: bigint;
  peers: number;
  startedAt: number;
  error?: SyncError;
}

type Listener = (s: SyncState) => void;

const TRANSITIONS: Record<SyncPhase, SyncPhase[]> = {
  idle: ["booting"],
  booting: ["syncing-headers", "error"],
  "syncing-headers": ["syncing-cells", "paused", "error"],
  "syncing-cells": ["ready", "syncing-headers", "paused", "error"],
  ready: ["syncing-cells", "paused", "error"],
  paused: ["syncing-headers", "syncing-cells", "ready", "error"],
  error: ["idle"],
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
    if (next !== "error") this.state.error = undefined;
    this.emit();
  }

  /** Update numeric fields without changing phase. */
  patch(patch: Partial<Omit<SyncState, "phase">>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  fail(error: SyncError): void {
    this.state = { ...this.state, phase: "error", error };
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
