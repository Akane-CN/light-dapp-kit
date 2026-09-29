import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { LightClientCccClient, type LightClientOptions } from "@light-dapp-kit/core";

export interface LightClientProviderProps extends LightClientOptions {
  children: ReactNode;
  /** Start syncing on mount (default true). */
  autoStart?: boolean;
  /** Blocks to look back when a script is first watched. 0 = from genesis. */
  watchFrom?: bigint;
}

const Ctx = createContext<LightClientCccClient | null>(null);

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
  ...opts
}: LightClientProviderProps) {
  const client = useMemo(
    () =>
      new LightClientCccClient({
        ...opts,
        config: { ...opts.config, ...(watchFrom !== undefined ? { defaultWatchDepth: watchFrom } : {}) },
      }),
    // Re-create only when the network changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.network],
  );

  useEffect(() => {
    if (autoStart) void client.start().catch(() => {});
    return () => void client.stop();
  }, [client, autoStart]);

  return (
    <Ctx.Provider value={client}>
      <ccc.Provider defaultClient={client}>{children}</ccc.Provider>
    </Ctx.Provider>
  );
}
