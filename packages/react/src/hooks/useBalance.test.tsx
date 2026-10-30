import { describe, expect, it } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { ccc } from "@ckb-ccc/core";
import { useBalance } from "./useBalance.js";
import { ADDRESS, LOCK, renderWithProvider, setConnectorSigner } from "../test/helpers.js";

describe("useBalance", () => {
  it("watches the lock, reads its capacity and reports ready", async () => {
    setConnectorSigner(undefined);
    const { result, client } = renderWithProvider(() => useBalance(ADDRESS));
    client.capacity = ccc.fixedPointFrom("1234.5");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toBe(ccc.fixedPointFrom("1234.5"));
    const watch = client.callsTo("watch")[0]!;
    expect(ccc.Script.from(watch.args[0] as ccc.ScriptLike).hash()).toBe(LOCK.hash());
    expect(watch.args[1]).toBe("lock");
  });

  it("reports syncing while not ready, then re-reads when the cell tip moves", async () => {
    setConnectorSigner(undefined);
    const { result, client } = renderWithProvider(() => useBalance(ADDRESS));
    act(() => client.setSync({ phase: "syncing-cells", cellTip: 10n }));
    client.capacity = 5n;
    await waitFor(() => expect(result.current.status).toBe("syncing"));
    const before = client.callsTo("getCellsCapacity").length;
    client.capacity = 7n;
    act(() => client.setSync({ phase: "ready", cellTip: 11n }));
    await waitFor(() => expect(result.current.data).toBe(7n));
    expect(result.current.status).toBe("ready");
    expect(client.callsTo("getCellsCapacity").length).toBeGreaterThan(before);
  });

  it("surfaces a query failure as error", async () => {
    setConnectorSigner(undefined);
    const { result, client } = renderWithProvider(() => useBalance(ADDRESS));
    client.getCellsCapacity = async () => { throw new Error("boom"); };
    act(() => client.setSync({ cellTip: 999n }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("boom");
  });

  it("stays idle without an address", () => {
    setConnectorSigner(undefined);
    const { result, client } = renderWithProvider(() => useBalance());
    expect(result.current.status).toBe("idle");
    expect(client.callsTo("watch")).toHaveLength(0);
  });
});
