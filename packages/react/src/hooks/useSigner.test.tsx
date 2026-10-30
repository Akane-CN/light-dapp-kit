import { describe, expect, it } from "vitest";
import { useSigner } from "./useSigner.js";
import { useSignerOverride } from "../provider.js";
import { fakeSigner, renderWithProvider, setConnectorSigner } from "../test/helpers.js";

describe("useSigner", () => {
  it("returns the connector's signer when nothing is injected", () => {
    const connected = fakeSigner();
    setConnectorSigner(connected);
    const { result } = renderWithProvider(() => useSigner());
    expect(result.current).toBe(connected);
  });

  it("prefers the signer injected through <LightClientProvider signer>", () => {
    setConnectorSigner(fakeSigner());
    const injected = fakeSigner();
    const { result } = renderWithProvider(
      () => ({ signer: useSigner(), override: useSignerOverride() }),
      { signer: () => injected as never },
    );
    expect(result.current.signer).toBe(injected);
    expect(result.current.override).toBe(injected);
  });

  it("is undefined with no wallet and no injection", () => {
    setConnectorSigner(undefined);
    const { result } = renderWithProvider(() => useSigner());
    expect(result.current).toBeUndefined();
  });
});
