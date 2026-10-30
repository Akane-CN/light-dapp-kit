import { describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { useLightClient } from "./hooks/useLightClient.js";
import { renderWithProvider } from "./test/helpers.js";

describe("LightClientProvider", () => {
  it("creates one client for the network, starts it on mount and stops it on unmount", () => {
    const { client, unmount } = renderWithProvider(() => useLightClient(), { autoStart: true });
    expect(client.cfg.network).toBe("testnet");
    expect(client.started).toBe(1);
    unmount();
    expect(client.stopped).toBe(1);
  });

  it("does not start when autoStart is false", () => {
    const { client } = renderWithProvider(() => useLightClient(), { autoStart: false });
    expect(client.started).toBe(0);
  });

  it("forwards watchFrom and watchFromBlock into the client config", () => {
    const { client } = renderWithProvider(() => useLightClient(), { watchFrom: 500n, watchFromBlock: 22888142n });
    expect(client.cfg.defaultWatchDepth).toBe(500n);
    expect(client.cfg.watchFromBlock).toBe(22888142n);
  });

  it("passes the signer factory the client it created", () => {
    let seen: unknown;
    const { client } = renderWithProvider(() => useLightClient(), {
      signer: ((c: unknown) => { seen = c; return { tag: "signer" }; }) as never,
    });
    expect(seen).toBe(client);
  });
});

describe("useLightClient", () => {
  it("reflects sync state updates and exposes the lifecycle controls", () => {
    const { result, client } = renderWithProvider(() => useLightClient());
    expect(result.current.sync.phase).toBe("ready");
    act(() => client.setSync({ phase: "error", error: { code: "POLL_FAILED", message: "x", retryable: true }, retry: { attempt: 1, nextAt: 1 } }));
    expect(result.current.sync.phase).toBe("error");
    act(() => {
      result.current.retry();
      result.current.pause();
      result.current.resume();
      void result.current.reset();
    });
    expect(client.retried).toBe(1);
    expect(client.calls.map((c) => c.method)).toEqual(expect.arrayContaining(["retry", "pause", "resume", "reset"]));
  });
});
