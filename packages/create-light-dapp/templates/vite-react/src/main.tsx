import React from "react";
import ReactDOM from "react-dom/client";
import { LightClientProvider } from "@light-dapp-kit/react";
import App from "./App";

const network = (new URLSearchParams(location.search).get("network") ?? "__NETWORK__") as "mainnet" | "testnet";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LightClientProvider network={network}>
      <App />
    </LightClientProvider>
  </React.StrictMode>,
);
