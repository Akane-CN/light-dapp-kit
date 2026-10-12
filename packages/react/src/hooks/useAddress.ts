import { useEffect, useState } from "react";
import { useSigner } from "./useSigner.js";

/** Resolve the address to query: explicit arg, else the connected signer's recommended address. */
export function useResolvedAddress(address?: string): string | undefined {
  const signer = useSigner();
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
