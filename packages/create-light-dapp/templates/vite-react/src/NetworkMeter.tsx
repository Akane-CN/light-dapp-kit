import { useEffect, useState } from "react";

/**
 * Shows reviewers at a glance that no HTTP JSON-RPC calls are made.
 * Counts fetch/XHR requests to foreign origins via PerformanceObserver.
 */
export function NetworkMeter() {
  const [http, setHttp] = useState(0);
  useEffect(() => {
    const obs = new PerformanceObserver((list) => {
      const n = list.getEntries().filter((e) => {
        const r = e as PerformanceResourceTiming;
        return (r.initiatorType === "fetch" || r.initiatorType === "xmlhttprequest") && !r.name.startsWith(location.origin);
      }).length;
      if (n) setHttp((c) => c + n);
    });
    obs.observe({ type: "resource", buffered: true });
    return () => obs.disconnect();
  }, []);
  return (
    <aside style={{ position: "fixed", right: 12, bottom: 12, fontSize: 12, padding: "6px 10px", border: "1px solid #ccc", borderRadius: 6, background: "#fff" }}>
      Foreign HTTP fetch/XHR: <strong style={{ color: http ? "crimson" : "green" }}>{http}</strong> (should stay 0)
    </aside>
  );
}
