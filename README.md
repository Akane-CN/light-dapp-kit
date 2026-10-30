# Light dApp Kit

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
cross-origin isolated. How that is achieved matters for wallets:

| Browser | Header sent by Vite dev/preview | Light client | Popup wallets (JoyID) |
| --- | --- | --- | --- |
| Chromium 137+ (Chrome, Edge, Brave) | `Document-Isolation-Policy: isolate-and-require-corp` | works | work: the popup keeps `window.opener` |
| Firefox, Safari, older Chromium | `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` | works | fail with "Popup closed": COOP severs the opener of cross-origin popups |

Extension wallets (MetaMask, OKX, UniSat, UTXO Global) inject a provider and are
unaffected either way. The header choice lives in `vite.config.ts`
(`isolationHeaders()`), keyed on the User-Agent.

Static hosts that cannot set headers (GitHub Pages) use
[`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker), which the
template ships in `public/`. It only emits COOP/COEP, so on GitHub Pages JoyID
cannot connect yet; teaching it to emit `Document-Isolation-Policy` on Chromium
is an M3 item.

Desktop Chromium is the primary target for v0. Mobile browsers are out of scope.

## Status

Spark Program (CKB Eco Fund) proposal — see `docs/`. MIT.
