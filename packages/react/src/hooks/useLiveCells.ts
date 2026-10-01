import { useCallback, useEffect, useState } from "react";
import type { ccc } from "@ckb-ccc/core";
import { useLightClient } from "./useLightClient.js";
import type { HookResult } from "./types.js";

export interface LiveCellsFilter {
  lock?: ccc.ScriptLike;
  type?: ccc.ScriptLike | null;
  withData?: boolean;
  limit?: number;
}

/** Paged live-cell query over the light client's local index. */
export function useLiveCells(filter: LiveCellsFilter): HookResult<ccc.Cell[]> & { hasMore: boolean; loadMore: () => void } {
  const { client, sync } = useLightClient();
  const [cells, setCells] = useState<ccc.Cell[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [status, setStatus] = useState<HookResult<never>["status"]>("idle");
  const [error, setError] = useState<Error | undefined>();
  const [hasMore, setHasMore] = useState(false);

  const fetchPage = useCallback(async (after?: string, append = false) => {
    if (!filter.lock) return;
    try {
      await client.watch(filter.lock, "lock");
      const key = {
        script: filter.lock,
        scriptType: "lock" as const,
        scriptSearchMode: "exact" as const,
        withData: filter.withData ?? false,
        ...(filter.type === null ? { filter: { scriptLenRange: [0n, 1n] as [bigint, bigint] } } : {}),
        ...(filter.type ? { filter: { script: filter.type } } : {}),
      };
      const page = await client.findCellsPagedNoCache(key, "asc", BigInt(filter.limit ?? 50), after);
      setCells((prev) => (append ? [...prev, ...page.cells] : page.cells));
      setCursor(page.lastCursor);
      setHasMore(page.cells.length === (filter.limit ?? 50));
      setStatus(sync.phase === "ready" ? "ready" : "syncing");
    } catch (e) {
      setError(e as Error);
      setStatus("error");
    }
  }, [client, filter.lock, filter.type, filter.withData, filter.limit, sync.phase]);

  useEffect(() => { void fetchPage(undefined, false); }, [fetchPage, sync.cellTip]);

  const loadMore = useCallback(() => { if (hasMore) void fetchPage(cursor, true); }, [fetchPage, cursor, hasMore]);

  return { data: cells, status, error, hasMore, loadMore };
}
