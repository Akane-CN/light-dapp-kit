import { useEffect, useState } from "react";
import { ccc } from "@ckb-ccc/core";
import { useLightClient } from "./useLightClient.js";
import { useResolvedAddress } from "./useAddress.js";
import type { HookResult } from "./types.js";

export interface DaoCell {
  cell: ccc.Cell;
  capacity: bigint;
  /** 0 = still depositing (phase 1); otherwise the deposit block number encoded in data. */
  depositBlock: bigint;
  isWithdrawing: boolean;
}

/** Nervos DAO cells owned by `address` (default: connected signer). */
export function useDaoDeposits(address?: string): HookResult<DaoCell[]> {
  const { client, sync } = useLightClient();
  const addr = useResolvedAddress(address);
  const [state, setState] = useState<HookResult<DaoCell[]>>({ data: undefined, status: "idle" });

  useEffect(() => {
    if (!addr) return;
    let alive = true;
    (async () => {
      try {
        const { script: lock } = await ccc.Address.fromString(addr, client);
        const dao = await client.getKnownScript(ccc.KnownScript.NervosDao);
        const daoType = ccc.Script.from({ codeHash: dao.codeHash, hashType: dao.hashType, args: "0x" });
        await client.watch(lock, "lock");
        const page = await client.findCellsPagedNoCache(
          { script: lock, scriptType: "lock", scriptSearchMode: "exact", withData: true, filter: { script: daoType } },
          "asc",
          100n,
        );
        const cells: DaoCell[] = page.cells.map((cell) => {
          const data = ccc.bytesFrom(cell.outputData);
          const depositBlock = data.length >= 8 ? ccc.numFromBytes(data.slice(0, 8)) : 0n;
          return { cell, capacity: cell.cellOutput.capacity, depositBlock, isWithdrawing: depositBlock !== 0n };
        });
        if (alive) setState({ data: cells, status: sync.phase === "ready" ? "ready" : "syncing" });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, status: "error", error: e as Error }));
      }
    })();
    return () => { alive = false; };
  }, [addr, client, sync.cellTip, sync.phase]);

  return state;
}
