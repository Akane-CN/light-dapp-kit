import { describe, expect, it } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { LOCK, renderWithProvider, setConnectorSigner } from "../test/helpers.js";
import { useLiveCells } from "./useLiveCells.js";

const cell = (i: number) => ({
  outPoint: { txHash: "0x" + i.toString(16).padStart(64, "0"), index: 0n },
  cellOutput: { capacity: 100n, lock: LOCK },
  outputData: "0x",
});

describe("useLiveCells", () => {
  it("queries a page for the lock and paginates with the returned cursor", async () => {
    setConnectorSigner(undefined);
    const { result, client } = renderWithProvider(() => useLiveCells({ lock: LOCK, limit: 2 }));
    client.cells = [cell(1), cell(2)];
    client.lastCursor = "0xcursor1";
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.hasMore).toBe(true);
    const first = client.callsTo("findCellsPagedNoCache")[0]!;
    expect(first.args[1]).toBe("asc");
    expect(first.args[2]).toBe(2n);
    expect(first.args[3]).toBeUndefined();

    client.cells = [cell(3)];
    client.lastCursor = "0xcursor2";
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(result.current.hasMore).toBe(false);
    const latest = client.callsTo("findCellsPagedNoCache").at(-1)!;
    expect(latest.args[3]).toBe("0xcursor1");
  });

  it("filters by type script, or for cells without a type when type is null", async () => {
    setConnectorSigner(undefined);
    const type = { codeHash: "0x" + "cc".repeat(32), hashType: "type" as const, args: "0x" };
    const { client } = renderWithProvider(() => useLiveCells({ lock: LOCK, type }));
    await waitFor(() => expect(client.callsTo("findCellsPagedNoCache")).toHaveLength(1));
    const withType = client.callsTo("findCellsPagedNoCache")[0]!.args[0] as { filter?: { script?: unknown } };
    expect(withType.filter?.script).toEqual(type);

    const r2 = renderWithProvider(() => useLiveCells({ lock: LOCK, type: null }));
    await waitFor(() => expect(r2.client.callsTo("findCellsPagedNoCache")).toHaveLength(1));
    const noType = r2.client.callsTo("findCellsPagedNoCache")[0]!.args[0] as { filter?: { scriptLenRange?: unknown } };
    expect(noType.filter?.scriptLenRange).toEqual([0n, 1n]);
  });

  it("does nothing without a lock", () => {
    setConnectorSigner(undefined);
    const { result, client } = renderWithProvider(() => useLiveCells({}));
    expect(result.current.status).toBe("idle");
    expect(client.callsTo("findCellsPagedNoCache")).toHaveLength(0);
  });
});
