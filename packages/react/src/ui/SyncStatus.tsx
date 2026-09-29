import { useLightClient } from "../hooks/useLightClient.js";

/** Minimal, unstyled sync status bar. Copy it into your app and restyle freely. */
export function SyncStatus() {
  const { sync, pause, resume, reset } = useLightClient();
  const pct = sync.networkTip > 0n ? Number((sync.headerTip * 100n) / sync.networkTip) : 0;
  const cellPct = sync.headerTip > 0n ? Number((sync.cellTip * 100n) / sync.headerTip) : 0;
  return (
    <div role="status" style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13 }}>
      <strong>{sync.phase}</strong>
      <span>headers {sync.headerTip.toString()} / {sync.networkTip.toString()} ({pct}%)</span>
      <span>cells {cellPct}%</span>
      <span>peers {sync.peers}</span>
      {sync.error && <span style={{ color: "crimson" }}>{sync.error.code}: {sync.error.message}</span>}
      {sync.phase === "paused" ? <button onClick={resume}>Resume</button> : <button onClick={pause}>Pause</button>}
      <button onClick={() => void reset()}>Reset local data</button>
    </div>
  );
}
