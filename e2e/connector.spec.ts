import { expect, test, type Page } from "@playwright/test";

/**
 * The real CCC connector path, end to end, with an injected EIP-6963 EVM wallet (see
 * apps/light-wallet/src/test-evm-wallet.ts). Unlike wallet.spec.ts — which injects a signer
 * and bypasses the connector — this picks a wallet from the actual connector UI, so it covers
 * discovery, selection, the EVM signer, the Omnilock address and personal_sign. No funds and
 * no browser extension are needed; the account is empty, so it only reads balance.
 *
 * Runs on testnet (the light client must reach a real peer), so it is grouped with the other
 * network e2e. The page under test still makes zero JSON-RPC requests.
 */
const WALLET_NAME = "Light dApp Test Wallet";
// Well-known Ethereum test key (0x1111…); its address is 0x19e7…ff2a.
const ETH_KEY = "0x" + "11".repeat(32);

test("connect through the connector UI with an EIP-6963 EVM wallet, zero JSON-RPC", async ({ page }) => {
  test.setTimeout(12 * 60 * 1000);
  const startedAt = Date.now();

  const rpcLike: string[] = [];
  await page.route("**/*", (route) => {
    const req = route.request();
    const foreign = !req.url().startsWith("http://localhost:4173");
    if (foreign && req.method() === "POST" && (req.headers()["content-type"] ?? "").includes("json")) rpcLike.push(req.url());
    void route.continue();
  });
  page.on("console", (m) => {
    const t = m.text();
    if ((m.type() === "error" || m.type() === "warning") && !/IdentifyProtocol|%cWARN/.test(t)) console.log(`[browser:${m.type()}] ${t.slice(0, 300)}`);
  });
  await page.addInitScript((k) => { (window as unknown as { __ETH_TEST_KEY?: string }).__ETH_TEST_KEY = k; }, ETH_KEY);

  await page.goto("/?network=testnet");

  // Open the connector and pick our injected wallet. The connector's lit components live in
  // shadow DOM; force the click because Playwright's visibility check on the slotted label
  // is unreliable (a plain click lands nowhere and the selection never fires).
  await page.getByRole("button", { name: "Connect wallet" }).click();
  const item = page.locator("ccc-selecting-scene ccc-button").filter({ hasText: WALLET_NAME }).first();
  await item.waitFor({ timeout: 20_000 });
  await item.scrollIntoViewIfNeeded().catch(() => {});
  await item.click({ force: true });

  await expect(page.getByRole("button", { name: new RegExp(`Connected: ${WALLET_NAME}`) })).toBeVisible({ timeout: 30_000 });
  console.log(`[connector] connected after ${Math.round((Date.now() - startedAt) / 1000)}s`);

  // Omnilock address derived from the EVM account.
  const address = page.getByTestId("address");
  await expect(address).toHaveText(/^ckt1/, { timeout: 30_000 });
  const addr = (await address.textContent())!.trim();
  console.log(`[connector] omnilock address: ${addr}`);
  test.info().annotations.push({ type: "omnilock-address", description: addr });

  // personal_sign through the connector's signer reaches our injected provider.
  const sig = await page.evaluate(async () => {
    const s = (window as unknown as { __signer?: { signMessage(m: string): Promise<{ signature: string }> } }).__signer;
    if (!s) return "no signer";
    try { return (await s.signMessage("light-dapp-kit")).signature; } catch (e) { return `error: ${String(e)}`; }
  });
  console.log(`[connector] signMessage -> ${sig}`);
  expect(sig, "the connector signer should personal_sign via the injected wallet").toMatch(/^0x[0-9a-f]{130}$/);

  // The empty account reads balance 0 once the light client is ready — proves the read path.
  await expect(page.getByRole("status").locator("strong")).toHaveText("ready", { timeout: 9 * 60 * 1000 });
  const balance = page.getByTestId("balance") as ReturnType<Page["getByTestId"]>;
  await expect(balance).toContainText("(ready)", { timeout: 3 * 60 * 1000 });
  console.log(`[connector] balance: ${(await balance.textContent())!.trim()}`);

  expect(rpcLike, "no JSON-RPC requests allowed").toEqual([]);
});
