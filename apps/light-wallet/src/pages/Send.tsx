import { useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { useSendTransaction, useSigner } from "@light-dapp-kit/react";

export default function Send() {
  const signer = useSigner();
  const { send, status, txHash, error } = useSendTransaction();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("100");

  async function onSend() {
    if (!signer) return;
    const { script } = await ccc.Address.fromString(to, signer.client);
    const tx = ccc.Transaction.from({ outputs: [{ lock: script, capacity: ccc.fixedPointFrom(amount) }] });
    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer);
    await send(tx);
  }

  if (!signer) return <p>Connect a wallet to send CKB.</p>;
  return (
    <section style={{ display: "grid", gap: 8, maxWidth: 480 }}>
      <input placeholder="Recipient address" value={to} onChange={(e) => setTo(e.target.value)} />
      <input placeholder="Amount (CKB)" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button data-testid="send-submit" onClick={() => void onSend()} disabled={status === "signing" || status === "broadcasting"}>Send</button>
      <p data-testid="send-status">Status: {status}{txHash && <> · tx <code style={{ wordBreak: "break-all" }}>{txHash}</code></>}</p>
      {error && <p data-testid="send-error" style={{ color: "crimson" }}>{error.message}</p>}
    </section>
  );
}
