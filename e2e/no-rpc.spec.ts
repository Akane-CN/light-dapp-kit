import { expect, test } from "@playwright/test";

/**
 * The acceptance test from the proposal (§6 "How to Verify", B):
 * the wallet must sync against testnet with zero HTTP JSON-RPC requests.
 */
test("syncs to ready with zero JSON-RPC requests", async ({ page }) => {
  const rpcLike: string[] = [];
  const sockets: string[] = [];
  await page.route("**/*", (route) => {
    const req = route.request();
    const foreign = !req.url().startsWith("http://localhost:4173");
    if (foreign && req.method() === "POST" && (req.headers()["content-type"] ?? "").includes("json")) {
      rpcLike.push(req.url());
    }
    void route.continue();
  });
  page.on("websocket", (ws) => sockets.push(ws.url()));

  const startedAt = Date.now();
  await page.goto("/?network=testnet");
  const status = page.getByRole("status");
  // The phase is rendered in <strong>; match it exactly so an error message
  // that merely mentions "ready" cannot satisfy the assertion.
  await expect(status.locator("strong")).toHaveText("ready", { timeout: 9 * 60 * 1000 });
  const elapsedMs = Date.now() - startedAt;

  // Capture the sync figures (M1 metric) in the report and the CI log.
  const text = (await status.textContent()) ?? "";
  test.info().annotations.push({ type: "first-sync", description: `${elapsedMs} ms — ${text.trim()}` });
  console.log(`[no-rpc] ready after ${elapsedMs} ms: ${text.trim()}`);

  expect(text, "sync must not have hit an error").not.toMatch(/POLL_FAILED|BOOT_FAILED/);
  const peers = Number(/peers\s+(\d+)/.exec(text)?.[1] ?? "0");
  expect(peers, "ready must come from at least one connected peer").toBeGreaterThan(0);
  expect(sockets.length, "expected at least one P2P websocket").toBeGreaterThan(0);
  expect(rpcLike, "no JSON-RPC requests allowed").toEqual([]);
});
