import { ccc } from "@ckb-ccc/connector-react";
import { useBalance, useLiveCells } from "@light-dapp-kit/react";
import { useEffect, useState } from "react";

export default function Balance() {
  const signer = ccc.useSigner();
  const [addr, setAddr] = useState<string>();
  useEffect(() => { void signer?.getRecommendedAddress().then(setAddr); }, [signer]);
  const bal = useBalance(addr);
  const [lock, setLock] = useState<ccc.Script>();
  useEffect(() => { if (addr && signer) void ccc.Address.fromString(addr, signer.client).then((a) => setLock(a.script)); }, [addr, signer]);
  const cells = useLiveCells({ lock, limit: 20 });

  if (!signer) return <p>Connect a wallet to see your balance.</p>;
  return (
    <section>
      <p style={{ wordBreak: "break-all" }}>{addr}</p>
      <h2>{bal.data !== undefined ? `${ccc.fixedPointToString(bal.data)} CKB` : "…"} <small>({bal.status})</small></h2>
      <h3>Live cells ({cells.data?.length ?? 0})</h3>
      <ul>
        {cells.data?.map((c) => (
          <li key={`${c.outPoint.txHash}:${c.outPoint.index}`}>
            {ccc.fixedPointToString(c.cellOutput.capacity)} CKB {c.cellOutput.type ? "· has type" : ""} {c.outputData !== "0x" ? "· has data" : ""}
          </li>
        ))}
      </ul>
      {cells.hasMore && <button onClick={cells.loadMore}>Load more</button>}
    </section>
  );
}
