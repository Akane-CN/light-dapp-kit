# Light dApp Kit

[![CI](https://github.com/Akane-CN/light-dapp-kit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Akane-CN/light-dapp-kit/actions/workflows/ci.yml)

Run the official CKB light client **inside the browser** and plug it into any
[CCC](https://github.com/ckb-devrel/ccc) dApp — no RPC server, no indexer, no backend.

```tsx
// before
<ccc.Provider defaultClient={new ccc.ClientPublicTestnet()}>

// after
<LightClientProvider network="testnet">
```

| Package | What |
| --- | --- |
| `@light-dapp-kit/core` | `LightClientCccClient` — a `ccc.Client` backed by `ckb-light-client-js`; framework-agnostic |
| `@light-dapp-kit/react` | `LightClientProvider` + `useLightClient` / `useBalance` / `useLiveCells` / `useDaoDeposits` / `useSendTransaction` |
| `create-light-dapp` | `bun create light-dapp my-app` scaffolder |
| `apps/light-wallet` | Reference dApp, deployed to GitHub Pages |

## Quick start

```sh
bun install
bun run build
bun run dev:wallet      # http://localhost:5173
```

## How to verify (no RPC)

1. Open the wallet, DevTools → Network, filter *Fetch/XHR*.
2. Connect a wallet, wait for sync, refresh balance.
3. There must be **zero** HTTP JSON-RPC requests; only `wss://` P2P sockets.
   `bun run e2e` asserts exactly this in headless Chrome.

### Automated wallet flow (testnet)

`e2e/wallet.spec.ts` drives the Balance, Nervos DAO and Send pages with a
private-key signer instead of a browser wallet, sends a real 100 CKB
self-transfer over P2P and waits for it to be committed, still with zero
JSON-RPC. The app only exposes the injection hook when built with
`VITE_ALLOW_TEST_SIGNER=1` (the e2e web server does); production bundles
never read it.

```sh
TESTNET_PRIVATE_KEY=0x…   # a testnet key funded from https://faucet.nervos.org
TESTNET_FROM_BLOCK=…      # optional: block that funded it, so cell sync starts there
TESTNET_EXPECT_DAO=1      # optional: require a Nervos DAO deposit to be listed
bun run e2e -- wallet.spec.ts
```

### Connector UI (testnet)

`e2e/connector.spec.ts` covers the real connector flow that `wallet.spec.ts`
bypasses. It injects an EIP-6963 EVM wallet backed by a fixed test key
(`apps/light-wallet/src/test-evm-wallet.ts`), picks it from the actual connector
dialog, then asserts the connection, the derived Omnilock address, a
`personal_sign` routed through the connector's signer, and a balance read — all
with zero JSON-RPC and no funds. The injected wallet is loaded only under
`VITE_ALLOW_TEST_SIGNER=1`, so production bundles never include it. Runs on
pushes to `main`.

### JoyID (canary)

`e2e/joyid.spec.ts` drives the real JoyID popup with a CDP virtual authenticator
(screenshots, trace and video recorded). JoyID accepts the WebAuthn credential
and then rejects it, because its client only continues when the credential's
AAGUID belongs to a listed passkey provider (Google Password Manager, iCloud
Keychain, Bitwarden, 1Password, ...), and Chrome's virtual authenticator reports
`01020304-0506-0708-0102-030405060708`. So this is a **canary**: it passes while
that gate holds and fails the day JoyID lets a virtual authenticator through,
which is the signal to turn it into a full integration test. It is opt-in
(`RUN_JOYID=1`; in CI it runs weekly, on manual dispatch, or on a `main` commit
tagged `[joyid]`). Until then the JoyID connection stays a manual check (Chrome
with a synced passkey, or macOS). An upstream request for a testnet AAGUID
allow-list toggle is the clean fix.

CI runs the wallet job on pushes to `main` from the `TESTNET_PRIVATE_KEY` secret and
the `TESTNET_FROM_BLOCK` / `TESTNET_EXPECT_DAO` repository variables; the spec
skips itself when the secret is absent. Keep nothing but faucet CKB on that key.

## Browser requirements

`ckb-light-client-js` uses `SharedArrayBuffer`, so the page must be
cross-origin isolated. How that is achieved decides whether popup wallets work.

### Support matrix

| Browser | Light client (sync, balance, send) | Popup wallets (JoyID) | Extension wallets (MetaMask, OKX, UniSat, UTXO Global) |
| --- | --- | --- | --- |
| Chrome / Edge / Brave 137+ | Yes, in CI | Yes | Yes |
| Chrome / Edge / Brave < 137 | Yes | No — COOP severs the popup's opener | Yes |
| Firefox (latest) | Expected, not in CI | No — same reason | Yes |
| Safari | Untested, not a v0 target | No | Untested |
| Mobile browsers | Out of scope | — | — |

"Yes, in CI" means the e2e suite exercises it in headless Chromium on every run; the other
rows are inferred from the isolation mechanism, since CI only runs Chromium. Desktop Chromium
is the primary target for v0; the Safari row reflects known IndexedDB-in-Worker differences
that are out of scope. Extension wallets inject a provider and are unaffected by the popup
limitation.

### How isolation is achieved

| Browser | Header sent by Vite dev/preview and the service worker | Popup wallets |
| --- | --- | --- |
| Chromium 137+ | `Document-Isolation-Policy: isolate-and-require-corp` | keep `window.opener` |
| Firefox, Safari, older Chromium | `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` | lose the opener (cross-origin popup "Popup closed") |

The header choice lives in `vite.config.ts` (`isolationHeaders()`), keyed on the User-Agent.

Static hosts that cannot set headers (GitHub Pages) use the kit's own
`coi-serviceworker.js` (in `public/`, MIT, based on
[gzuidhof/coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)). It
injects the same per-browser headers: `Document-Isolation-Policy` on Chromium
137+ (so JoyID works on Pages too) and COOP/COEP elsewhere. It no-ops when the
page is already isolated by real headers.

## Status

Spark Program (CKB Eco Fund) proposal — see `docs/`. MIT.
