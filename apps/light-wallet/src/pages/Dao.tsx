import { ccc } from "@ckb-ccc/connector-react";
import { useDaoDeposits } from "@light-dapp-kit/react";

export default function Dao() {
  const signer = ccc.useSigner();
  const dao = useDaoDeposits();
  if (!signer) return <p>Connect a wallet to see Nervos DAO deposits.</p>;
  return (
    <section>
      <h2>Nervos DAO <small>({dao.status})</small></h2>
      {dao.data?.length === 0 && <p>No DAO cells for this address.</p>}
      <ul>
        {dao.data?.map((d) => (
          <li key={`${d.cell.outPoint.txHash}:${d.cell.outPoint.index}`}>
            {ccc.fixedPointToString(d.capacity)} CKB · {d.isWithdrawing ? `withdrawing (deposited at #${d.depositBlock})` : "depositing"}
          </li>
        ))}
      </ul>
    </section>
  );
}
