import React from "react";
import ReactDOM from "react-dom/client";
import { ccc } from "@ckb-ccc/connector-react";
import { LightClientProvider } from "@light-dapp-kit/react";
import App from "./App";

const params = new URLSearchParams(location.search);
const network = (params.get("network") ?? "testnet") as "mainnet" | "testnet";
// Optional absolute block to start cell sync from, e.g. the block that funded the wallet.
const fromBlock = params.get("fromBlock");
const watchFromBlock = fromBlock ? BigInt(fromBlock) : undefined;

// Test-only signer: the e2e suite injects a testnet private key through this global.
// The branch is compiled out unless the build sets VITE_ALLOW_TEST_SIGNER=1, so
// production bundles never read it.
declare global {
  interface Window { __LIGHT_WALLET_TEST_KEY?: string; __ETH_TEST_KEY?: string }
}
const allowTest = import.meta.env.VITE_ALLOW_TEST_SIGNER === "1";
const testKey = allowTest ? window.__LIGHT_WALLET_TEST_KEY : undefined;
const testSigner = testKey ? (client: ccc.Client) => new ccc.SignerCkbPrivateKey(client, testKey) : undefined;

// Test-only: announce an EIP-6963 EVM wallet from a fixed key, so the e2e connector suite can
// pick a wallet from the real connector UI. Dynamically imported so prod bundles never load it.
if (allowTest && window.__ETH_TEST_KEY) {
  void import("./test-evm-wallet").then((m) => m.registerTestEvmWallet(window.__ETH_TEST_KEY!));
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LightClientProvider network={network} watchFromBlock={watchFromBlock} signer={testSigner}>
      <App />
    </LightClientProvider>
  </React.StrictMode>,
);
