import { useCallback, useSyncExternalStore } from "react";
import type { SyncState } from "@light-dapp-kit/core";
import { useLightClientContext } from "../provider.js";

export function useLightClient() {
  const client = useLightClientContext();
  const sync = useSyncExternalStore<SyncState>(
    (cb) => client.onSyncState(cb),
    () => client.syncState(),
    () => client.syncState(),
  );
  const start = useCallback(() => client.start(), [client]);
  const pause = useCallback(() => client.pause(), [client]);
  const resume = useCallback(() => client.resume(), [client]);
  const reset = useCallback(() => client.reset(), [client]);
  const retry = useCallback(() => client.retry(), [client]);
  return { client, sync, start, pause, resume, reset, retry };
}
