import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * JoyID (passkey wallet) through the CCC connector, driven headlessly:
 *   - the page is served with Document-Isolation-Policy, so the JoyID popup keeps its opener;
 *   - a CDP virtual authenticator answers WebAuthn in the popup, so no human touches a key;
 *   - every step is screenshotted and attached, the popup's text and buttons are logged,
 *     trace + video are recorded, and a markdown summary lands in test-results/.
 *
 * This is a CANARY. JoyID's client accepts the WebAuthn credential and then rejects it
 * because the virtual authenticator's AAGUID is not a listed passkey provider, so the test
 * asserts that gate: it PASSES while JoyID still blocks the virtual authenticator and FAILS
 * the day JoyID lets it through, which is the signal to turn this into a real end-to-end
 * test. It only reaches the credential step (no server-side account is created), but it does
 * hit testnet.joyid.dev, so it is opt-in: RUN_JOYID=1.
 */
const RUN = process.env.RUN_JOYID === "1";
const SUMMARY = path.resolve(__dirname, "test-results/joyid-summary.md");

test.use({ trace: "on", video: "on" });

test.describe("JoyID passkey wallet through the connector", () => {
  test.skip(!RUN, "set RUN_JOYID=1 to run (hits testnet.joyid.dev; see the file header)");

  test("canary: connector opens JoyID, WebAuthn runs, AAGUID gate still holds", async ({ page, context }) => {
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

    // Probe for every page in the context (the JoyID popup included): report the platform
    // authenticator check and any WebAuthn error to the console so the log shows why a
    // passkey step failed.
    await context.addInitScript(() => {
      const w = window as unknown as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } };
      if (location.hostname.includes("joyid")) {
        w.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()
          .then((v) => console.error(`[probe] isUserVerifyingPlatformAuthenticatorAvailable=${v}`))
          .catch((e) => console.error(`[probe] isUVPAA threw ${String(e)}`));
        for (const method of ["create", "get"] as const) {
          const orig = navigator.credentials[method].bind(navigator.credentials);
          (navigator.credentials as unknown as Record<string, unknown>)[method] = async (opts: unknown) => {
            const pk = (opts as { publicKey?: Record<string, unknown> })?.publicKey ?? {};
            console.error(`[probe] credentials.${method}: ${JSON.stringify({ rp: pk.rp, authenticatorSelection: pk.authenticatorSelection, attestation: pk.attestation, pubKeyCredParams: pk.pubKeyCredParams, userVerification: pk.userVerification, extensions: pk.extensions && Object.keys(pk.extensions as object) })}`);
            try {
              const r = await orig(opts as CredentialCreationOptions & CredentialRequestOptions);
              let extra = "";
              const resp = (r as PublicKeyCredential | null)?.response as AuthenticatorAttestationResponse | undefined;
              if (method === "create" && resp && typeof resp.getAuthenticatorData === "function") {
                const ad = new Uint8Array(resp.getAuthenticatorData());
                const hex = [...ad.slice(37, 53)].map((x) => x.toString(16).padStart(2, "0")).join("");
                extra = ` aaguid=${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)} flags=${ad[32].toString(2).padStart(8, "0")} transports=${JSON.stringify(resp.getTransports?.())}`;
              }
              console.error(`[probe] credentials.${method} ok: ${r?.id?.slice(0, 16)}${extra}`);
              return r;
            }
            catch (e) { console.error(`[probe] credentials.${method} failed: ${String(e)}`); throw e; }
          };
        }
      }
    });
    await page.goto("/?network=testnet");
    const isolated = await page.evaluate(() => ({ crossOriginIsolated, ua: navigator.userAgent }));
    note(`page loaded; crossOriginIsolated=${isolated.crossOriginIsolated} (${isolated.ua.slice(0, 60)})`);
    expect(isolated.crossOriginIsolated, "light client needs SharedArrayBuffer").toBe(true);

    // Connector: "Connect wallet" → JoyID Passkey → CKB. The lit components sit in shadow DOM;
    // click by coordinates because the slotted label does not forward clicks reliably.
    await page.getByRole("button", { name: "Connect wallet" }).click();
    const sceneText = () => page.evaluate(() => {
      const c = document.querySelector("ccc-connector")?.shadowRoot;
      return [...(c?.querySelectorAll("*") ?? [])]
        .filter((e) => e.tagName.includes("-"))
        .map((e) => `${e.tagName.toLowerCase()}:${(e.shadowRoot?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120)}`)
        .join(" | ");
    });
    const connectorItem = (text: string) => page.locator("ccc-selecting-scene ccc-button").filter({ hasText: text }).first();
    const clickConnectorItem = async (text: string) => {
      const item = connectorItem(text);
      await item.waitFor({ timeout: 20_000 });
      const box = (await item.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    // The JoyID entry opens a second list (CKB / BTC / Nostr / EVM). The slotted label does
    // not always forward the first click, so retry until that list is showing.
    await connectorItem("JoyID").waitFor({ timeout: 20_000 });
    note(`connector: ${await sceneText()}`);
    let popup: Page | undefined;
    for (let attempt = 1; attempt <= 5 && !popup; attempt++) {
      await clickConnectorItem("JoyID");
      const ckb = connectorItem("CKB");
      const shown = await ckb.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
      note(`attempt ${attempt}: JoyID clicked, CKB entry ${shown ? "shown" : "not shown"}; scene: ${await sceneText()}`);
      if (!shown) { await page.waitForTimeout(1500); continue; }
      await shot(page, `01-connector-joyid-${attempt}`);
      const popupPromise = page.waitForEvent("popup", { timeout: 20_000 }).catch(() => undefined);
      await clickConnectorItem("CKB");
      popup = await popupPromise;
      if (!popup) note(`attempt ${attempt}: CKB clicked but no popup; scene: ${await sceneText()}`);
    }
    if (!popup) { await shot(page, "01-connector-failed"); throw new Error("connector did not open the JoyID popup"); }
    let credentialCreated = false;
    popup.on("console", (m) => {
      const t = m.text();
      if (t.startsWith("[probe]")) { note(`popup ${t}`); if (/credentials\.create ok/.test(t)) credentialCreated = true; }
      else if (m.type() === "error") console.log(`[popup:error] ${t.slice(0, 300)}`);
    });
    note(`popup opened (${popup.url()})`);

    // The connector opens a blank popup first and then points it at JoyID. The cross-origin
    // navigation swaps the renderer, so the virtual authenticator is attached only after it
    // (JoyID runs its WebAuthn checks on button click, so nothing is missed).
    await popup.waitForURL(/joyid\.dev|joy\.id/, { timeout: 30_000 });
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    note(`popup navigated to ${popup.url().split("?")[0]}`);
    const cdp = await context.newCDPSession(popup);
    await cdp.send("WebAuthn.enable", { enableUI: false });
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal",
        hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
        hasLargeBlob: true, hasPrf: true, automaticPresenceSimulation: true,
        defaultBackupEligibility: true, defaultBackupState: true,
      },
    });
    note(`virtual authenticator attached (${authenticatorId})`);
    const uvpaa = await popup.evaluate(() => PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()).catch((e) => `threw ${String(e).slice(0, 60)}`);
    note(`popup isUserVerifyingPlatformAuthenticatorAvailable after attach: ${uvpaa}`);
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
    // Buttons that were on the landing screen stay in the DOM (hidden) after "Create New";
    // only a button that newly appeared, or is visible and not yet tried, is worth clicking.
    const primaryRe = /^(Authenticate|Continue|Next|Confirm|Authorize|Approve|Connect|Sign in|Register|Done|OK|Allow|Agree|Create)/i;
    const landing = new Set(state.buttons);
    const tried = new Set<string>(["Create New"]);
    // Two outcomes end the walk: JoyID shows the "not supported" gate (the expected
    // state today, because the virtual authenticator's AAGUID is not a listed passkey
    // provider), or the app reports a JoyID connection (the gate is gone — see below).
    let outcome: "gated" | "connected" | "unknown" = "unknown";
    const connectedButton = page.getByRole("button", { name: /Connected: JoyID/ });
    for (let step = 1; step <= 12 && outcome === "unknown"; step++) {
      await popup.waitForTimeout(3000);
      if (await connectedButton.isVisible().catch(() => false)) { outcome = "connected"; break; }
      if (popup.isClosed()) { note(`popup step ${step}: popup closed`); if (await connectedButton.isVisible().catch(() => false)) outcome = "connected"; break; }
      state = await describe();
      if (/not supported in current environment/i.test(state.text)) { outcome = "gated"; note("JoyID shows the \"not supported in current environment\" gate"); await shot(popup, "03-joyid-rejected"); break; }
      const visible = (await popup.locator("button:visible").allInnerTexts().catch(() => [])).map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean);
      note(`popup step ${step}: url=${popup.url().split("?")[0]} visible=${JSON.stringify(visible)} inputs=${JSON.stringify(state.inputs.filter((i) => !/^(checkbox|range):$/.test(i)))} text="${state.text.slice(0, 500)}"`);
      await shot(popup, `03-joyid-step${step}`);
      const nameInput = popup.locator("input[type=text]:visible, input:not([type]):visible").first();
      if ((await nameInput.count()) > 0 && (await nameInput.inputValue().catch(() => "")) === "") {
        const name = `lightdapp${Date.now() % 100000}`;
        await nameInput.fill(name).catch(() => {});
        note(`filled name "${name}"`);
      }
      const candidates = visible.filter((b) => !tried.has(b) && !(landing.has(b) && !primaryRe.test(b)));
      const primary = candidates.find((b) => primaryRe.test(b) && !landing.has(b)) ?? candidates.find((b) => primaryRe.test(b));
      if (primary) {
        tried.add(primary);
        const ok = await popup.getByRole("button", { name: primary, exact: true }).filter({ visible: true }).first().click({ timeout: 10_000 }).then(() => true).catch((e) => { note(`click "${primary}" failed: ${String(e).slice(0, 80)}`); return false; });
        if (ok) note(`clicked "${primary}"`);
      } else {
        note(`no new primary button among ${JSON.stringify(visible)}; waiting`);
      }
    }

    mkdirSync(path.dirname(SUMMARY), { recursive: true });
    writeFileSync(SUMMARY, lines.join("\n") + "\n");

    // This is a canary, not a full integration test. JoyID's client accepts the WebAuthn
    // credential and then rejects it because Chrome's virtual authenticator reports an
    // AAGUID (01020304-...) that is not one of its listed passkey providers. We assert that
    // known gate so the test passes today AND fails loudly the day JoyID lets a virtual /
    // test authenticator through — at which point this spec should become a real end-to-end
    // test (connect, assert the ckt1 address, read balance; those steps are kept in git
    // history for that conversion).
    expect(credentialCreated, "JoyID should have called navigator.credentials.create()").toBe(true);
    if (outcome === "connected") {
      throw new Error("JoyID connected with a virtual authenticator: the AAGUID gate is gone. Convert this canary (e2e/joyid.spec.ts) into a real integration test — assert Connected: JoyID, the ckt1 address and the balance.");
    }
    expect(outcome, "expected JoyID to reach its known 'not supported in current environment' gate").toBe("gated");
    note("canary PASS: credential created, JoyID still gates the virtual authenticator by AAGUID");
  });
});
