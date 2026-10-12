/**
 * Network presets. `ckb-light-client-js` accepts `{ type: "MainNet" | "TestNet", config? }`
 * where `config` is the light client TOML. When `config` is omitted the package's
 * built-in defaults are used; we expose `bootnodes` so a dApp can add its own
 * (e.g. community boot nodes) without rewriting the whole TOML.
 */
export type NetworkName = "mainnet" | "testnet";

export interface NetworkConfig {
  name: NetworkName;
  /** Value passed to LightClient.start() as `type`. */
  lcType: "MainNet" | "TestNet";
  /** IndexedDB database name prefix. One DB per network per origin. */
  dbName: string;
  /** Extra bootnodes in multiaddr form. Only `/wss/` peers work on https pages. */
  bootnodes: string[];
  /** Default fee rate in shannons/KB used when estimate_cycles is unavailable. */
  defaultFeeRate: bigint;
  /** Default number of blocks to look back when a script is first watched. */
  defaultWatchDepth: bigint;
  /**
   * Absolute block number to start watching from (e.g. the block that funded
   * the wallet). Overrides `defaultWatchDepth` when set.
   */
  watchFromBlock?: bigint;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  mainnet: {
    name: "mainnet",
    lcType: "MainNet",
    dbName: "ckb-light-client-mainnet",
    bootnodes: [],
    defaultFeeRate: 1000n,
    defaultWatchDepth: 1000n,
  },
  testnet: {
    name: "testnet",
    lcType: "TestNet",
    dbName: "ckb-light-client-testnet",
    bootnodes: [],
    defaultFeeRate: 1000n,
    defaultWatchDepth: 1000n,
  },
};

export function resolveNetwork(
  name: NetworkName,
  overrides: Partial<NetworkConfig> = {},
): NetworkConfig {
  return { ...NETWORKS[name], ...overrides };
}

/**
 * Build the light client TOML when custom bootnodes are supplied.
 * TODO(M1): confirm exact TOML keys against ckb-light-client config/*.toml.
 */
export function buildLightClientToml(cfg: NetworkConfig): string | undefined {
  if (cfg.bootnodes.length === 0) return undefined;
  const list = cfg.bootnodes.map((b) => `    "${b}"`).join(",\n");
  return `chain = "${cfg.name}"\n\n[store]\npath = "data/store"\n\n[network]\npath = "data/network"\nlisten_addresses = []\nbootnodes = [\n${list}\n]\nmax_peers = 125\nmax_outbound_peers = 8\nping_interval_secs = 120\nping_timeout_secs = 1200\nconnect_outbound_interval_secs = 15\nupnp = false\ndiscovery_local_address = false\nbootnode_mode = false\n`;
}
