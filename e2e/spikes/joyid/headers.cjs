// Spike: which isolation headers keep SharedArrayBuffer AND the JoyID popup's opener?
// Serves apps/light-wallet/dist under each header set and reports crossOriginIsolated + opener.
// Run: bun run --cwd apps/light-wallet build && node e2e/spikes/joyid/headers.cjs
const { chromium } = require("@playwright/test");
const { spawn } = require("child_process");
const VARIANTS = {
  "COOP same-origin + COEP require-corp": { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
  "COOP same-origin-allow-popups + COEP require-corp": { "Cross-Origin-Opener-Policy": "same-origin-allow-popups", "Cross-Origin-Embedder-Policy": "require-corp" },
  "COOP noopener-allow-popups + COEP require-corp": { "Cross-Origin-Opener-Policy": "noopener-allow-popups", "Cross-Origin-Embedder-Policy": "require-corp" },
  "Document-Isolation-Policy isolate-and-require-corp": { "Document-Isolation-Policy": "isolate-and-require-corp" },
  "Document-Isolation-Policy isolate-and-credentialless": { "Document-Isolation-Policy": "isolate-and-credentialless" },
};
(async () => {
  const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) });
  let port = 4300;
  for (const [name, headers] of Object.entries(VARIANTS)) {
    port++;
    const srv = spawn("node", [__dirname + "/serve.cjs"], { env: { ...process.env, PORT: String(port), HEADERS: JSON.stringify(headers) }, stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 800));
    const context = await browser.newContext();
    const page = await context.newPage();
    let openerErr = "";
    page.on("console", (m) => { const t = m.text(); if (/popup|Popup|opener/i.test(t) && !/^%c/.test(t)) openerErr += t.slice(0, 160) + " | "; });
    await page.addInitScript(() => { const o = window.open; window.open = function (...a) { const w = o.apply(this, a); window.__p = w; return w; }; });
    try {
      await page.goto(`http://localhost:${port}/?network=testnet`, { waitUntil: "domcontentloaded" });
      const iso = await page.evaluate(() => ({ crossOriginIsolated, sab: typeof SharedArrayBuffer !== "undefined" }));
      console.log(`\n### ${name}\n  crossOriginIsolated=${iso.crossOriginIsolated} SharedArrayBuffer=${iso.sab}`);
      await page.getByRole("button", { name: "Connect wallet" }).click();
      const clickBtn = async (text) => { const b = page.locator("ccc-selecting-scene ccc-button").filter({ hasText: text }).first(); await b.waitFor({ timeout: 10000 }); const box = await b.boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); };
      await clickBtn("JoyID"); await page.waitForTimeout(3000);
      console.log("  scene:", await page.evaluate(() => [...document.querySelector("ccc-connector").shadowRoot.querySelectorAll("*")].filter((e) => e.tagName.includes("-")).map((e) => e.tagName.toLowerCase() + ":" + (e.shadowRoot?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160)).join(" || ")));
      await page.screenshot({ path: `${__dirname}/variant-${port}.png` });
      const pp = page.waitForEvent("popup", { timeout: 15000 }).catch(() => null);
      await clickBtn("CKB");
      const popup = await pp;
      let opener = "no popup", closedSeenByOpener = "n/a";
      if (popup) {
        await popup.waitForLoadState("domcontentloaded").catch(() => {});
        await popup.waitForTimeout(3000);
        opener = await popup.evaluate(() => (window.opener ? "present" : "NULL")).catch((e) => "eval failed");
        closedSeenByOpener = await page.evaluate(() => window.__p && window.__p.closed);
      }
      console.log(`  popup.opener=${opener}  opener sees closed=${closedSeenByOpener}\n  app console: ${openerErr || "-"}`);
    } catch (e) { console.log(`  FAILED: ${e.message.split("\n")[0].slice(0, 200)}`); }
    await context.close();
    srv.kill();
  }
  await browser.close();
})();
