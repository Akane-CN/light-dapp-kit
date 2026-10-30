import { renderHook, type RenderHookOptions } from "@testing-library/react";
import type { ReactNode } from "react";
import { ccc } from "@ckb-ccc/core";
import { LightClientProvider, type LightClientProviderProps } from "../provider.js";
import { connectorState } from "./fakeConnector.js";
import { lastClient, resetInstances, type FakeLightClient } from "./fakeCore.js";

export const LOCK = ccc.Script.from({ codeHash: "0x" + "9b".repeat(32), hashType: "type", args: "0x" + "01".repeat(20) });
export const ADDRESS = ccc.Address.from({ script: LOCK, prefix: "ckt" }).toString();

/** A signer whose address is ADDRESS and whose signTransaction returns the tx untouched. */
export function fakeSigner(overrides: Record<string, unknown> = {}) {
  return {
    client: { addressPrefix: "ckt" },
    getRecommendedAddress: async () => ADDRESS,
    signTransaction: async (tx: unknown) => tx,
    ...overrides,
  };
}

type ProviderProps = Omit<LightClientProviderProps, "children" | "network"> & { network?: "mainnet" | "testnet" };

/** Render a hook inside LightClientProvider (backed by FakeLightClient) and return the client too. */
export function renderWithProvider<T>(
  hook: () => T,
  props: ProviderProps = {},
  options: Omit<RenderHookOptions<unknown>, "wrapper"> = {},
): { client: FakeLightClient } & ReturnType<typeof renderHook<T, unknown>> {
  resetInstances();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LightClientProvider network="testnet" autoStart={false} {...props}>{children}</LightClientProvider>
  );
  const r = renderHook(hook, { wrapper, ...options });
  return Object.assign(r, { client: lastClient() });
}

export function setConnectorSigner(signer: unknown): void {
  connectorState.signer = signer;
}

/** Let pending promises settle. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
