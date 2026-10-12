import { useEffect, useState } from "react";
import { ccc } from "@ckb-ccc/core";
import { useLightClient } from "./useLightClient.js";
import { useResolvedAddress } from "./useAddress.js";
import type { HookResult } from "./types.js";

/**
 * CKB balance of `address` (default: connected signer). Automatically watches the lock script.
 * While the light client is syncing, `data` may be a stale value from the last successful read.
 */
export function useBalance(address?: string): HookResult<bigint> {
  const { client, sync } = useLightClient();
  const addr = useResolvedAddress(address);
  const [state, setState] = useState<HookResult<bigint>>({ data: undefined, status: "idle" });

  useEffect(() => {
    if (!addr) return;
    let alive = true;
    (async () => {
      try {
        const { script } = await ccc.Address.fromString(addr, client);
        await client.watch(script, "lock");
        const cap = await client.getCellsCapacity({ script, scriptType: "lock", scriptSearchMode: "exact" });
        if (alive) setState({ data: cap, status: client.syncState().phase === "ready" ? "ready" : "syncing" });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, status: "error", error: e as Error }));
      }
    })();
    return () => { alive = false; };
    // Re-query whenever the cell tip advances.
  }, [addr, client, sync.cellTip, sync.phase]);

  return state;
}
