import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { LightClientCccClient, type LightClientOptions } from "@light-dapp-kit/core";

export interface LightClientProviderProps extends LightClientOptions {
  children: ReactNode;
  /** Start syncing on mount (default true). */
  autoStart?: boolean;
  /** Blocks to look back when a script is first watched. 0 = from genesis. */
  watchFrom?: bigint;
  /** Absolute block number to start watching from; overrides `watchFrom`. */
  watchFromBlock?: bigint;
  /**
   * Bypass the wallet connector with a signer bound to the light client, e.g.
   * `(client) => new ccc.SignerCkbPrivateKey(client, key)` in tests or dev tools.
   * Pass a stable function (module scope or useCallback); it is re-run per client.
   */
  signer?: (client: LightClientCccClient) => ccc.Signer;
}

const Ctx = createContext<LightClientCccClient | null>(null);
const SignerCtx = createContext<ccc.Signer | undefined>(undefined);

/** The signer injected through `<LightClientProvider signer>`, if any. */
export function useSignerOverride(): ccc.Signer | undefined {
  return useContext(SignerCtx);
}

export function useLightClientContext(): LightClientCccClient {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLightClient* hooks must be used inside <LightClientProvider>");
  return c;
}

/**
 * Drop-in replacement for `<ccc.Provider defaultClient={...}>`.
 * Creates one LightClientCccClient per network and hands it to CCC as the default client,
 * so ccc.useCcc(), signers and transaction helpers work unchanged.
 */
export function LightClientProvider({
  children,
  autoStart = true,
  watchFrom,
  watchFromBlock,
  signer,
  ...opts
}: LightClientProviderProps) {
  const client = useMemo(
    () =>
      new LightClientCccClient({
        ...opts,
        config: {
          ...opts.config,
          ...(watchFrom !== undefined ? { defaultWatchDepth: watchFrom } : {}),
          ...(watchFromBlock !== undefined ? { watchFromBlock } : {}),
        },
      }),
    // Re-create only when the network changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.network],
  );

  useEffect(() => {
    if (autoStart) void client.start().catch(() => {});
    return () => void client.stop();
  }, [client, autoStart]);

  const overrideSigner = useMemo(() => signer?.(client), [client, signer]);

  return (
    <Ctx.Provider value={client}>
      <SignerCtx.Provider value={overrideSigner}>
        <ccc.Provider defaultClient={client}>{children}</ccc.Provider>
      </SignerCtx.Provider>
    </Ctx.Provider>
  );
}
