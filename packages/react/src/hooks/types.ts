export type HookStatus = "idle" | "syncing" | "ready" | "error";

export interface HookResult<T> {
  data: T | undefined;
  status: HookStatus;
  error?: Error;
}
