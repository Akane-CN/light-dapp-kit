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

  await page.goto("/?network=testnet");
  await expect(page.getByRole("status")).toContainText("ready", { timeout: 9 * 60 * 1000 });

  expect(sockets.length, "expected at least one P2P websocket").toBeGreaterThan(0);
  expect(rpcLike, "no JSON-RPC requests allowed").toEqual([]);
});
