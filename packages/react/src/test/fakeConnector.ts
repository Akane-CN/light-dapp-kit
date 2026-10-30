/** Stand-in for `@ckb-ccc/connector-react`: a passthrough Provider and a settable signer. */
import type { ReactNode } from "react";

export const connectorState: { signer: unknown } = { signer: undefined };

function Provider({ children }: { children: ReactNode }) {
  return children as JSX.Element;
}
function useSigner() {
  return connectorState.signer;
}
function useCcc() {
  return { open: () => {}, close: () => {}, disconnect: () => {}, wallet: undefined, signerInfo: undefined };
}

export const ccc = { Provider, useSigner, useCcc };
