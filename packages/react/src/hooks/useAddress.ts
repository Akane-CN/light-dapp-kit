import { useEffect, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";

/** Resolve the address to query: explicit arg, else the connected signer's recommended address. */
export function useResolvedAddress(address?: string): string | undefined {
  const signer = ccc.useSigner();
  const [resolved, setResolved] = useState<string | undefined>(address);
  useEffect(() => {
    if (address) { setResolved(address); return; }
    if (!signer) { setResolved(undefined); return; }
    let alive = true;
    void signer.getRecommendedAddress().then((a) => alive && setResolved(a));
    return () => { alive = false; };
  }, [address, signer]);
  return resolved;
}
