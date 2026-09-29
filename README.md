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

## Browser requirements

`ckb-light-client-js` uses `SharedArrayBuffer`, so the page must be
cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: require-corp`). Vite dev server sets these
headers in `vite.config.ts`; static hosts that cannot set headers (GitHub Pages)
use [`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker), which
the template ships in `public/`.

Desktop Chrome / Firefox are supported. Safari and mobile browsers are out of
scope for v0.

## Status

Spark Program (CKB Eco Fund) proposal — see `docs/`. MIT.
