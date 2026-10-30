import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useResolvedAddress } from "./useAddress.js";
import { ADDRESS, fakeSigner, renderWithProvider, setConnectorSigner } from "../test/helpers.js";

describe("useResolvedAddress", () => {
  it("returns an explicit address as is", () => {
    setConnectorSigner(undefined);
    const { result } = renderWithProvider(() => useResolvedAddress("ckt1explicit"));
    expect(result.current).toBe("ckt1explicit");
  });

  it("falls back to the signer's recommended address", async () => {
    setConnectorSigner(fakeSigner());
    const { result } = renderWithProvider(() => useResolvedAddress());
    await waitFor(() => expect(result.current).toBe(ADDRESS));
  });

  it("is undefined with no signer", () => {
    setConnectorSigner(undefined);
    const { result } = renderWithProvider(() => useResolvedAddress());
    expect(result.current).toBeUndefined();
  });
});
