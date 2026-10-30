# light-wallet

A CCC dApp that runs the CKB light client **in your browser** — no RPC server.

```sh
bun install
bun run dev
```

## How to verify there is no RPC

1. Open http://localhost:5173, DevTools → Network, filter *Fetch/XHR*.
2. Connect a wallet (JoyID works well on testnet), wait for `ready` in the status bar.
3. The "Foreign HTTP fetch/XHR" meter in the corner must read **0**. Only `wss://` sockets appear under *WS*.

Switch network with `?network=mainnet`.

Deploying to GitHub Pages: drop `coi-serviceworker.js` into `public/` (see `public/README-coi.md`), push to `main`.
