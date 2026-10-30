import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { ccc } from "@ckb-ccc/core";
import { useDaoDeposits } from "./useDaoDeposits.js";
import { DAO_SCRIPT } from "../test/fakeCore.js";
import { ADDRESS, LOCK, renderWithProvider, setConnectorSigner } from "../test/helpers.js";

const daoCell = (capacityCkb: string, depositBlock: bigint) => ({
  outPoint: { txHash: "0x" + "11".repeat(32), index: 0n },
  cellOutput: { capacity: ccc.fixedPointFrom(capacityCkb), lock: LOCK, type: { ...DAO_SCRIPT, args: "0x" } },
  // Nervos DAO data: 8-byte little-endian deposit block number; 0 while depositing.
  outputData: ccc.hexFrom(ccc.numToBytes(depositBlock, 8)),
});

describe("useDaoDeposits", () => {
  it("lists DAO cells and decodes the withdrawing state from the data", async () => {
    setConnectorSigner(undefined);
    const { result, client } = renderWithProvider(() => useDaoDeposits(ADDRESS));
    client.cells = [daoCell("102", 0n), daoCell("500", 22888152n)];
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    const [depositing, withdrawing] = result.current.data!;
    expect(depositing.isWithdrawing).toBe(false);
    expect(depositing.capacity).toBe(ccc.fixedPointFrom("102"));
    expect(withdrawing.isWithdrawing).toBe(true);
    expect(withdrawing.depositBlock).toBe(22888152n);
    expect(result.current.status).toBe("ready");

    const key = client.callsTo("findCellsPagedNoCache")[0]!.args[0] as {
      filter?: { script?: { codeHash: string } };
      withData?: boolean;
    };
    expect(key.filter?.script?.codeHash).toBe(DAO_SCRIPT.codeHash);
    expect(key.withData).toBe(true);
    expect(client.callsTo("getKnownScript")[0]!.args[0]).toBe(ccc.KnownScript.NervosDao);
  });

  it("returns an empty list for an address with no DAO cells", async () => {
    setConnectorSigner(undefined);
    const { result, client } = renderWithProvider(() => useDaoDeposits(ADDRESS));
    client.cells = [];
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(result.current.status).toBe("ready");
  });

  it("surfaces a query failure as error", async () => {
    setConnectorSigner(undefined);
    const { result, client } = renderWithProvider(() => useDaoDeposits(ADDRESS));
    client.findCellsPagedNoCache = async () => { throw new Error("index down"); };
    client.setSync({ cellTip: 42n });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("index down");
  });
});
