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

## Automating the JoyID login itself (open)

Under DIP the popup opens and keeps its opener, so the remaining obstacle is the
passkey. Chrome's CDP `WebAuthn` domain can attach a virtual authenticator to the
popup (`WebAuthn.enable`, `WebAuthn.addVirtualAuthenticator` with `ctap2`,
`internal`, resident keys, automatic presence) before clicking "Create New" or
"Login with Passkey". Two things still need a manual experiment, because each
run registers a real JoyID testnet account:

1. whether `WebAuthn.addCredential` with a fixed P-256 key makes JoyID resolve
   the same account (and therefore the same CKB address) on every run;
2. how JoyID's login flow behaves with a discoverable credential it has never
   seen in its own storage.

Until both are answered, the wallet e2e uses a private-key signer instead
(`e2e/wallet.spec.ts`).
