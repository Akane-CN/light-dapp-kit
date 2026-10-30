import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { useSendTransaction } from "./useSendTransaction.js";
import { fakeSigner, renderWithProvider, setConnectorSigner } from "../test/helpers.js";

const TX = { outputs: [] };

describe("useSendTransaction", () => {
  // shouldAdvanceTime lets React 18's scheduler still flush renders (it uses a macrotask),
  // while advanceTimersByTimeAsync drives the hook's 3 s poll sleeps deterministically.
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("signs, broadcasts and polls until committed", async () => {
    setConnectorSigner(fakeSigner());
    const { result, client } = renderWithProvider(() => useSendTransaction());
    client.sendResult = "0x" + "cd".repeat(32);
    client.txResponses = [undefined, { status: "committed" }];

    let sent: Promise<string>;
    act(() => { sent = result.current.send(TX); });
    await waitFor(() => expect(result.current.status).toBe("pending"));
    expect(result.current.txHash).toBe("0x" + "cd".repeat(32));
    expect(client.callsTo("sendTransactionNoCache")).toHaveLength(1);

    // Two poll ticks: first undefined (still pending), second committed.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(result.current.status).toBe("pending");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await waitFor(() => expect(result.current.status).toBe("committed"));
    await expect(sent!).resolves.toBe("0x" + "cd".repeat(32));
  });

  it("refuses to send while the light client is not synced", async () => {
    setConnectorSigner(fakeSigner());
    const { result, client } = renderWithProvider(() => useSendTransaction());
    act(() => client.setSync({ phase: "syncing-cells" }));
    await waitFor(() => expect(result.current).toBeTruthy());

    let err: unknown;
    await act(async () => { await result.current.send(TX).catch((e) => { err = e; }); });
    expect((err as { code?: string }).code).toBe("NOT_SYNCED");
    expect(result.current.status).toBe("error");
    expect(client.callsTo("sendTransactionNoCache")).toHaveLength(0);
  });

  it("errors with no signer connected", async () => {
    setConnectorSigner(undefined);
    const { result } = renderWithProvider(() => useSendTransaction());
    let err: unknown;
    await act(async () => { await result.current.send(TX).catch((e) => { err = e; }); });
    expect((err as Error).message).toMatch(/no signer/);
  });

  it("surfaces a broadcast failure as error", async () => {
    setConnectorSigner(fakeSigner());
    const { result, client } = renderWithProvider(() => useSendTransaction());
    client.sendResult = new Error("rejected by peers");
    await act(async () => { await result.current.send(TX).catch(() => {}); });
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("rejected by peers");
  });
});
