import { useEffect, useState } from "react";
import { useLightClient } from "../hooks/useLightClient.js";

/** Minimal, unstyled sync status bar. Copy it into your app and restyle freely. */
export function SyncStatus() {
  const { sync, pause, resume, reset, retry } = useLightClient();
  const pct = sync.networkTip > 0n ? Number((sync.headerTip * 100n) / sync.networkTip) : 0;
  const cellPct = sync.headerTip > 0n ? Number((sync.cellTip * 100n) / sync.headerTip) : 0;
  const retryIn = useCountdown(sync.retry?.nextAt);
  return (
    <div role="status" style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13 }}>
      <strong>{sync.phase}</strong>
      <span>headers {sync.headerTip.toString()} / {sync.networkTip.toString()} ({pct}%)</span>
      <span>cells {cellPct}%</span>
      <span>peers {sync.peers}</span>
      {sync.error && (
        <span style={{ color: "crimson" }}>
          {sync.error.code}: {sync.error.message}
          {sync.retry && <> · retry {sync.retry.attempt} in {retryIn}s</>}
        </span>
      )}
      {sync.phase === "error" && sync.error?.retryable && <button onClick={retry}>Retry now</button>}
      {sync.phase === "paused" ? <button onClick={resume}>Resume</button> : <button onClick={pause}>Pause</button>}
      <button onClick={() => void reset()}>Reset local data</button>
    </div>
  );
}

/** Seconds until `at` (epoch ms), ticking once a second; 0 when unset or past. */
function useCountdown(at: number | undefined): number {
  const calc = () => (at ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 0);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (!at) return;
    const t = setInterval(() => setLeft(calc()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);
  return left;
}
