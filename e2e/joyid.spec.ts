import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * JoyID (passkey wallet) through the CCC connector, fully automated:
 *   - the page is served with Document-Isolation-Policy, so the JoyID popup keeps its opener;
 *   - a CDP virtual authenticator answers WebAuthn in the popup, so no human touches a key;
 *   - every step is screenshotted and attached, the popup's text and buttons are logged,
 *     trace + video are recorded, and a markdown summary lands in test-results/.
 *
 * Each run registers a fresh JoyID testnet account, so it is opt-in: RUN_JOYID=1.
 */
const RUN = process.env.RUN_JOYID === "1";
const SUMMARY = path.resolve(__dirname, "test-results/joyid-summary.md");

test.use({ trace: "on", video: "on" });

test.describe("JoyID passkey wallet through the connector", () => {
  test.skip(!RUN, "set RUN_JOYID=1 to run (registers a JoyID testnet account per run)");

  test("registers a passkey in the JoyID popup and connects", async ({ page, context }) => {
    test.setTimeout(8 * 60 * 1000);
    const startedAt = Date.now();
    const lines: string[] = ["# JoyID e2e summary", ""];
    const note = (s: string) => { console.log(`[joyid] +${Math.round((Date.now() - startedAt) / 1000)}s ${s}`); lines.push(`- ${s}`); };
    const shot = async (target: Page, name: string) => {
      const body = await target.screenshot({ fullPage: true }).catch(() => undefined);
      if (body) await test.info().attach(name, { body, contentType: "image/png" });
    };
    page.on("console", (m) => {
      const t = m.text();
      if ((m.type() === "error" || m.type() === "warning") && !/IdentifyProtocol|%cWARN/.test(t)) console.log(`[app:${m.type()}] ${t.slice(0, 300)}`);
    });

    await page.goto("/?network=testnet");
    const isolated = await page.evaluate(() => ({ crossOriginIsolated, ua: navigator.userAgent }));
    note(`page loaded; crossOriginIsolated=${isolated.crossOriginIsolated} (${isolated.ua.slice(0, 60)})`);
    expect(isolated.crossOriginIsolated, "light client needs SharedArrayBuffer").toBe(true);

    // Connector: "Connect wallet" → JoyID Passkey → CKB. The lit components sit in shadow DOM;
    // click by coordinates because the slotted label does not forward clicks reliably.
    await page.getByRole("button", { name: "Connect wallet" }).click();
    const clickConnectorItem = async (text: string) => {
      const item = page.locator("ccc-selecting-scene ccc-button").filter({ hasText: text }).first();
      await item.waitFor({ timeout: 15_000 });
      const box = (await item.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    await clickConnectorItem("JoyID");
    await page.waitForTimeout(1000);
    await shot(page, "01-connector-joyid");
    const popupPromise = page.waitForEvent("popup", { timeout: 20_000 });
    await clickConnectorItem("CKB");
    const popup = await popupPromise;
    popup.on("console", (m) => { if (m.type() === "error") console.log(`[popup:error] ${m.text().slice(0, 300)}`); });
    note(`popup opened (${popup.url()})`);

    // Virtual authenticator, attached before the popup makes any WebAuthn call. The CDP
    // session is bound to the popup target, so it survives the navigation to JoyID.
    const cdp = await context.newCDPSession(popup);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    note(`virtual authenticator attached (${authenticatorId})`);
    // The connector opens a blank popup first and then points it at JoyID.
    await popup.waitForURL(/joyid\.dev|joy\.id/, { timeout: 30_000 });
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    note(`popup navigated to ${popup.url().split("?")[0]}`);
    let opener = "unreadable";
    for (let i = 0; i < 10 && opener === "unreadable"; i++) {
      opener = await popup.evaluate(() => (window.opener ? "present" : "null")).catch(() => "unreadable");
      if (opener === "unreadable") await popup.waitForTimeout(1000);
    }
    note(`popup window.opener: ${opener}`);
    expect(opener, "popup must keep its opener (Document-Isolation-Policy)").toBe("present");

    const describe = async () => {
      const text = (await popup.evaluate(() => document.body.innerText).catch(() => "")).replace(/\s+/g, " ").trim();
      const buttons = (await popup.locator("button").allInnerTexts().catch(() => [])).map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean);
      const inputs = await popup.locator("input").evaluateAll((els) => els.map((e) => `${(e as HTMLInputElement).type}:${(e as HTMLInputElement).placeholder || (e as HTMLInputElement).name || ""}`)).catch(() => [] as string[]);
      return { text, buttons, inputs };
    };

    await popup.getByRole("button", { name: "Create New" }).waitFor({ timeout: 60_000 });
    let state = await describe();
    note(`popup step 0: buttons=${JSON.stringify(state.buttons)} inputs=${JSON.stringify(state.inputs)} text="${state.text.slice(0, 200)}"`);
    await shot(popup, "02-joyid-step0");
    await popup.getByRole("button", { name: "Create New" }).click();

    // Walk whatever JoyID shows next: fill a name if asked, press the obvious primary button,
    // stop when the popup closes (JoyID posts its result and closes itself).
    const primaryRe = /^(Create|Continue|Next|Confirm|Authorize|Approve|Connect|Sign in|Register|Done|OK|Allow|Agree)/i;
    for (let step = 1; step <= 8; step++) {
      await popup.waitForTimeout(3000);
      if (popup.isClosed()) { note(`popup step ${step}: popup closed`); break; }
      state = await describe();
      note(`popup step ${step}: url=${popup.url().split("?")[0]} buttons=${JSON.stringify(state.buttons)} inputs=${JSON.stringify(state.inputs)} text="${state.text.slice(0, 200)}"`);
      await shot(popup, `03-joyid-step${step}`);
      const nameInput = popup.locator("input[type=text], input:not([type])").first();
      if ((await nameInput.count()) > 0 && (await nameInput.inputValue().catch(() => "")) === "") {
        const name = `lightdapp${Date.now() % 100000}`;
        await nameInput.fill(name).catch(() => {});
        note(`filled name "${name}"`);
      }
      const primary = state.buttons.find((b) => primaryRe.test(b));
      if (primary) {
        await popup.getByRole("button", { name: primary, exact: true }).first().click().catch((e) => note(`click "${primary}" failed: ${String(e).slice(0, 80)}`));
        note(`clicked "${primary}"`);
      } else {
        note("no obvious primary button; waiting");
      }
    }

    // Back in the app: the connector should report JoyID and the Balance page the new address.
    await expect(page.getByRole("button", { name: /Connected: JoyID/ })).toBeVisible({ timeout: 60_000 });
    note("app shows Connected: JoyID");
    await shot(page, "04-app-connected");
    const address = page.getByTestId("address");
    await expect(address).toHaveText(/^ckt1/, { timeout: 60_000 });
    const addr = (await address.textContent())!.trim();
    note(`JoyID testnet address: ${addr}`);
    test.info().annotations.push({ type: "joyid-address", description: addr });

    // Let the light client reach ready and read the (empty) balance of the new account.
    await expect(page.getByRole("status").locator("strong")).toHaveText("ready", { timeout: 4 * 60 * 1000 });
    await expect(page.getByTestId("balance")).toContainText("(ready)", { timeout: 3 * 60 * 1000 });
    note(`balance page: ${(await page.getByTestId("balance").textContent())!.trim()}`);
    await shot(page, "05-app-ready");

    const creds = await cdp.send("WebAuthn.getCredentials", { authenticatorId }).catch(() => ({ credentials: [] as { rpId: string; isResidentCredential: boolean }[] }));
    note(`virtual authenticator holds ${creds.credentials.length} credential(s): ${creds.credentials.map((c) => `${c.rpId} resident=${c.isResidentCredential}`).join(", ")}`);

    mkdirSync(path.dirname(SUMMARY), { recursive: true });
    writeFileSync(SUMMARY, lines.join("\n") + "\n");
  });
});
