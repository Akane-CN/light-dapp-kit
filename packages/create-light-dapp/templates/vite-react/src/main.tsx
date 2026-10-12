import React from "react";
import ReactDOM from "react-dom/client";
import { ccc } from "@ckb-ccc/connector-react";
import { LightClientProvider } from "@light-dapp-kit/react";
import App from "./App";

const params = new URLSearchParams(location.search);
const network = (params.get("network") ?? "__NETWORK__") as "mainnet" | "testnet";
// Optional absolute block to start cell sync from, e.g. the block that funded the wallet.
const fromBlock = params.get("fromBlock");
const watchFromBlock = fromBlock ? BigInt(fromBlock) : undefined;

// Test-only signer: the e2e suite injects a testnet private key through this global.
// The branch is compiled out unless the build sets VITE_ALLOW_TEST_SIGNER=1, so
// production bundles never read it.
declare global {
  interface Window { __LIGHT_WALLET_TEST_KEY?: string }
}
const testKey = import.meta.env.VITE_ALLOW_TEST_SIGNER === "1" ? window.__LIGHT_WALLET_TEST_KEY : undefined;
const testSigner = testKey ? (client: ccc.Client) => new ccc.SignerCkbPrivateKey(client, testKey) : undefined;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LightClientProvider network={network} watchFromBlock={watchFromBlock} signer={testSigner}>
      <App />
    </LightClientProvider>
  </React.StrictMode>,
);
