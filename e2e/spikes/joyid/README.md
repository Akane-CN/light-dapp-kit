# JoyID spike

Exploratory scripts (not run in CI) behind the browser-requirements section of the
root README.

- `headers.cjs` serves the built wallet under several isolation header sets and
  reports, for each, whether `crossOriginIsolated` holds and whether the JoyID
  popup keeps `window.opener`. Result on Chrome 153: only
  `Document-Isolation-Policy` gives both; COOP `same-origin` severs the opener
  (JoyID shows "Popup closed"); COOP `same-origin-allow-popups` is not isolated.
- `serve.cjs` is the tiny static server it uses.

```sh
bun run --cwd apps/light-wallet build
node e2e/spikes/joyid/headers.cjs
PW_CHROMIUM_PATH=/path/to/chrome node e2e/spikes/joyid/headers.cjs   # optional browser override
```

## Automating the JoyID login itself (answered)

`e2e/joyid.spec.ts` drives the real popup with a CDP virtual authenticator.
What was established, in order (CI logs and screenshots in the `joyid-report`
artifact of any `[joyid]` run):

1. The connector's JoyID entry needs a retried click; the popup starts as
   `about:blank` and then navigates to `https://testnet.joyid.dev/auth`.
2. The virtual authenticator must be attached after that navigation (the
   cross-origin navigation swaps the renderer); afterwards
   `isUserVerifyingPlatformAuthenticatorAvailable()` is true in the popup.
3. JoyID calls `credentials.create()` with `rp.id = testnet.joyid.dev`,
   platform attachment, resident key, user verification required, ES256 or
   RS256. The call succeeds.
4. JoyID then rejects the credential: "JoyID is not supported in current
   environment ... sync Chrome with Google Account". Its client checks the
   attestation's AAGUID against an allow-list of passkey providers (Google
   Password Manager `ea9b8d66-…`, iCloud Keychain `fbfc3007-…`, Bitwarden,
   1Password, LastPass, ProtoPass, its own recovery key) and, outside macOS and
   iOS, refuses the all-zero AAGUID as well. Chrome's virtual authenticator
   reports `01020304-0506-0708-0102-030405060708`, which is on no list.

Getting past step 4 would mean rewriting the attestation object's AAGUID to
impersonate a listed provider before JoyID's server sees it. That is forging
attestation metadata sent to a third-party service, so it is deliberately not
done here. The JoyID connection therefore stays a manual check (Chrome with a
synced passkey, or macOS); everything up to and including the WebAuthn
ceremony is covered by the spec.
