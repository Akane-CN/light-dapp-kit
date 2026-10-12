import { expect, test } from "@playwright/test";
import { ccc } from "@ckb-ccc/core";

/**
 * Wallet pages driven by a private-key signer instead of a browser wallet
 * (the app enables the injection hook only when built with VITE_ALLOW_TEST_SIGNER=1).
 *
 * Needs a funded testnet key:
 *   TESTNET_PRIVATE_KEY   0x-prefixed secp256k1 key (keep only faucet CKB on it)
 *   TESTNET_FROM_BLOCK    optional: block that funded the address, so cell sync starts there
 *   TESTNET_EXPECT_DAO=1  optional: require at least one Nervos DAO deposit to be listed
 */
const KEY = process.env.TESTNET_PRIVATE_KEY;
const FROM_BLOCK = process.env.TESTNET_FROM_BLOCK;
const EXPECT_DAO = process.env.TESTNET_EXPECT_DAO === "1";

test.describe("wallet pages with a private-key signer (testnet)", () => {
  test.skip(!KEY, "set TESTNET_PRIVATE_KEY to a funded testnet key to run this suite");

  test("balance, DAO list and a self-transfer, with zero JSON-RPC requests", async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);
    const key = KEY!;
    const expectedAddress = await new ccc.SignerCkbPrivateKey(new ccc.ClientPublicTestnet(), key).getRecommendedAddress();

    const rpcLike: string[] = [];
    await page.route("**/*", (route) => {
      const req = route.request();
      const foreign = !req.url().startsWith("http://localhost:4173");
      if (foreign && req.method() === "POST" && (req.headers()["content-type"] ?? "").includes("json")) {
        rpcLike.push(req.url());
      }
      void route.continue();
    });
    page.on("console", (m) => { if (m.type() === "error") console.log(`[browser] ${m.text()}`); });
    await page.addInitScript((k) => { window.__LIGHT_WALLET_TEST_KEY = k; }, key);

    const startedAt = Date.now();
    await page.goto(`/?network=testnet${FROM_BLOCK ? `&fromBlock=${FROM_BLOCK}` : ""}`);
    await expect(page.getByRole("button", { name: "Connected: test signer" })).toBeVisible();
    await expect(page.getByRole("status").locator("strong")).toHaveText("ready", { timeout: 9 * 60 * 1000 });

    // Balance page (default). The hook reports "(ready)" once cells for the lock are indexed.
    await expect(page.getByTestId("address")).toHaveText(expectedAddress);
    const balance = page.getByTestId("balance");
    await expect
      .poll(async () => {
        const t = (await balance.textContent()) ?? "";
        return t.includes("(ready)") ? parseFloat(t.replace(/,/g, "")) : -1;
      }, { timeout: 8 * 60 * 1000, intervals: [3000] })
      .toBeGreaterThan(200); // 100 CKB transfer + 61 CKB change + fee
    const balanceText = (await balance.textContent())!.trim();
    console.log(`[wallet] balance after ${Date.now() - startedAt} ms: ${balanceText}`);
    test.info().annotations.push({ type: "balance", description: balanceText });

    // Nervos DAO page.
    await page.locator("nav").getByRole("button", { name: "Dao" }).click();
    await expect(page.getByTestId("dao")).toContainText("(ready)", { timeout: 3 * 60 * 1000 });
    const deposits = await page.getByTestId("dao-list").locator("li").count();
    console.log(`[wallet] dao deposits listed: ${deposits}`);
    test.info().annotations.push({ type: "dao-deposits", description: String(deposits) });
    if (EXPECT_DAO) expect(deposits, "TESTNET_EXPECT_DAO=1 but no deposit listed").toBeGreaterThan(0);

    // Send page: 100 CKB to ourselves, broadcast over P2P, wait until committed.
    await page.locator("nav").getByRole("button", { name: "Send" }).click();
    await page.getByPlaceholder("Recipient address").fill(expectedAddress);
    await page.getByPlaceholder("Amount (CKB)").fill("100");
    const sentAt = Date.now();
    await page.getByTestId("send-submit").click();
    const sendStatus = page.getByTestId("send-status");
    await expect
      .poll(async () => (await sendStatus.textContent()) ?? "", { timeout: 8 * 60 * 1000, intervals: [2000] })
      .toMatch(/committed|error/);
    const statusText = (await sendStatus.textContent())!.trim();
    const errorText = (await page.getByTestId("send-error").textContent().catch(() => null)) ?? "";
    console.log(`[wallet] send after ${Date.now() - sentAt} ms: ${statusText} ${errorText}`);
    expect(statusText, errorText).toContain("committed");
    const txHash = /0x[0-9a-f]{64}/.exec(statusText)?.[0] ?? "";
    test.info().annotations.push({ type: "tx", description: txHash });

    expect(rpcLike, "no JSON-RPC requests allowed").toEqual([]);
  });
});
