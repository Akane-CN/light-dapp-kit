import { useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { SyncStatus } from "@light-dapp-kit/react";
import Balance from "./pages/Balance";
import Send from "./pages/Send";
// dao-start
import Dao from "./pages/Dao";
// dao-end
import { NetworkMeter } from "./NetworkMeter";

const pages = {
  Balance,
  Send,
  // dao-start
  Dao,
  // dao-end
} as const;

export default function App() {
  const { open, wallet } = ccc.useCcc();
  const [page, setPage] = useState<keyof typeof pages>("Balance");
  const Page = pages[page];
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 20 }}>__APP_NAME__</h1>
        <button onClick={open}>{wallet ? `Connected: ${wallet.name}` : "Connect wallet"}</button>
      </header>
      <SyncStatus />
      <nav style={{ display: "flex", gap: 8, margin: "1rem 0" }}>
        {Object.keys(pages).map((p) => (
          <button key={p} onClick={() => setPage(p as keyof typeof pages)} disabled={p === page}>{p}</button>
        ))}
      </nav>
      <Page />
      <NetworkMeter />
    </main>
  );
}
