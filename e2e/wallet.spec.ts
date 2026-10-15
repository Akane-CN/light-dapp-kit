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
const FAUCET_URL = process.env.TESTNET_FAUCET_URL ?? "https://faucet.nervos.org/claim_events";
/** Below this the address is topped up from the faucet before the run. */
const MIN_BALANCE_CKB = 500n;
/** 100 CKB transfer + 61 CKB change + fee must be visible to the light client. */
const MIN_VISIBLE_CKB = 200;
const ONE_CKB = ccc.fixedPointFrom("1");

/**
 * Test setup, from Node: check the address on a public RPC node, claim from the
 * faucet when it runs low, and find the block of its latest activity so the light
 * client only has to scan from there. The page under test still makes zero RPC calls.
 */
async function prepareAddress(address: string): Promise<{ balance: bigint; fromBlock: bigint | undefined }> {
  const rpc = new ccc.ClientPublicTestnet();
  const { script } = await ccc.Address.fromString(address, rpc);
  const key = { script, scriptType: "lock" as const, scriptSearchMode: "exact" as const };
  const balanceOf = async () => (await rpc.getCellsCapacity(key)) / ONE_CKB;
  const latestBlock = async () => {
    const page = await rpc.findTransactionsPaged({ ...key, groupByTransaction: true }, "desc", 1n);
    return page.transactions[0]?.blockNumber;
  };

  let balance = await balanceOf();
  console.log(`[wallet] on-chain balance: ${balance} CKB (${address})`);
  if (balance < MIN_BALANCE_CKB) {
    const res = await fetch(FAUCET_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ claim_event: { address_hash: address } }),
    });
    console.log(`[wallet] faucet claim: HTTP ${res.status} ${(await res.text()).replace(/\s+/g, " ").slice(0, 300)}`);
    for (let i = 0; i < 36 && balance < MIN_BALANCE_CKB; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      balance = await balanceOf();
    }
    console.log(`[wallet] on-chain balance after faucet: ${balance} CKB`);
  }

  const latest = await latestBlock();
  const fromBlock = latest !== undefined ? (latest > 10n ? latest - 10n : 0n) : undefined;
  console.log(`[wallet] latest activity at block ${latest ?? "unknown"}; light client will watch from ${fromBlock ?? "default depth"}`);
  return { balance, fromBlock };
}

test.describe("wallet pages with a private-key signer (testnet)", () => {
  test.skip(!KEY, "set TESTNET_PRIVATE_KEY to a funded testnet key to run this suite");

  test("balance, DAO list and a self-transfer, with zero JSON-RPC requests", async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);
    const key = KEY!;
    const expectedAddress = await new ccc.SignerCkbPrivateKey(new ccc.ClientPublicTestnet(), key).getRecommendedAddress();
    const prepared = await prepareAddress(expectedAddress);
    expect(prepared.balance, "test address is unfunded and the faucet did not help").toBeGreaterThanOrEqual(MIN_BALANCE_CKB);
    const fromBlock = FROM_BLOCK ?? prepared.fromBlock?.toString();

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
    await page.addInitScript((k) => { (window as unknown as { __LIGHT_WALLET_TEST_KEY?: string }).__LIGHT_WALLET_TEST_KEY = k; }, key);

    const startedAt = Date.now();
    await page.goto(`/?network=testnet${fromBlock ? `&fromBlock=${fromBlock}` : ""}`);
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
      .toBeGreaterThan(MIN_VISIBLE_CKB);
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
    const sendStatus = page.getByTestId("send-status");
    let statusText = "", errorText = "";
    // A shared test key races with other people spending the same cells; retry on error.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const sentAt = Date.now();
      await page.getByTestId("send-submit").click();
      await expect
        .poll(async () => (await sendStatus.textContent()) ?? "", { timeout: 8 * 60 * 1000, intervals: [2000] })
        .toMatch(/committed|error/);
      statusText = (await sendStatus.textContent())!.trim();
      errorText = (await page.getByTestId("send-error").textContent().catch(() => null)) ?? "";
      console.log(`[wallet] send attempt ${attempt} after ${Date.now() - sentAt} ms: ${statusText} ${errorText}`);
      if (statusText.includes("committed")) break;
      await page.waitForTimeout(10_000);
    }
    expect(statusText, errorText).toContain("committed");
    const txHash = /0x[0-9a-f]{64}/.exec(statusText)?.[0] ?? "";
    test.info().annotations.push({ type: "tx", description: txHash });

    expect(rpcLike, "no JSON-RPC requests allowed").toEqual([]);
  });
});
