import { useCallback, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { useLightClient } from "./useLightClient.js";
import { useSigner } from "./useSigner.js";

type SendStatus = "idle" | "signing" | "broadcasting" | "pending" | "committed" | "error";

/**
 * Sign with the connected CCC signer, broadcast over the light client's P2P link,
 * then poll until the transaction is committed.
 */
export function useSendTransaction() {
  const { client, sync } = useLightClient();
  const signer = useSigner();
  const [status, setStatus] = useState<SendStatus>("idle");
  const [txHash, setTxHash] = useState<ccc.Hex | undefined>();
  const [error, setError] = useState<Error | undefined>();

  const send = useCallback(async (tx: ccc.TransactionLike): Promise<ccc.Hex> => {
    setError(undefined);
    if (!signer) throw new Error("no signer connected");
    if (sync.phase !== "ready") {
      const e = Object.assign(new Error("light client not synced"), { code: "NOT_SYNCED" });
      setError(e); setStatus("error"); throw e;
    }
    try {
      setStatus("signing");
      const signed = await signer.signTransaction(tx);
      setStatus("broadcasting");
      const hash = await client.sendTransactionNoCache(signed);
      setTxHash(hash);
      setStatus("pending");
      // Poll via fetch_transaction-backed getTransaction until committed.
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const r = await client.getTransactionNoCache(hash);
        if (r?.status === "committed") { setStatus("committed"); break; }
      }
      return hash;
    } catch (e) {
      setError(e as Error); setStatus("error"); throw e;
    }
  }, [client, signer, sync.phase]);

  return { send, status, txHash, error };
}
