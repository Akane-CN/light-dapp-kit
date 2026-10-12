import { ccc } from "@ckb-ccc/connector-react";
import { useSignerOverride } from "../provider.js";

/**
 * The signer to act with: the one injected via `<LightClientProvider signer>`
 * when present, otherwise the wallet connected through the CCC connector.
 * Use this instead of `ccc.useSigner()` so dev tools and tests can bypass wallets.
 */
export function useSigner(): ccc.Signer | undefined {
  const override = useSignerOverride();
  const connected = ccc.useSigner();
  return override ?? connected;
}
