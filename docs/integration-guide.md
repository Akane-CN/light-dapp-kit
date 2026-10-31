# Integration guide (draft, filled in during M3)

## Minimal change

Replace your `ccc.Provider` with `LightClientProvider`. Everything else stays.

## Migration checklist (from RPC mode)

A step-by-step for an existing CCC dApp. The only required steps are 1–4; the rest
is handling the ways a light client differs from a node (detailed below).

1. **Install.** `bun add @light-dapp-kit/react @light-dapp-kit/core` (they peer-depend
   on `@ckb-ccc/core` and `@ckb-ccc/connector-react`, which you already have).
2. **Swap the provider.** Replace `<ccc.Provider defaultClient={new ccc.ClientPublic*()}>`
   with `<LightClientProvider network="mainnet" | "testnet">`. It builds the light-client
   client for that network and still renders `ccc.Provider` inside, so the connector UI,
   `ccc.useSigner()` and all transaction helpers keep working. Pick the network with the
   prop — the client binds to the matching CCC base class (addresses and known scripts
   follow the network).
3. **Give a watch start block.** A light client scans block filters linearly (~600
   blocks/s), so never start from genesis. Pass `watchFromBlock`, or let the hooks use the
   default 1,000-block look-back, or compute one from a date with
   `client.watchFromDate(script, type, date, safetyBlocks)`. See the cell-sync note below.
4. **Make the page cross-origin isolated.** `SharedArrayBuffer` requires it. Use the
   template's `vite.config.ts` `isolationHeaders()` for dev/preview and your own host; drop
   `public/coi-serviceworker.js` in for static hosts (GitHub Pages). See *Cross-origin
   isolation*. If you ship popup wallets (JoyID), you need the Document-Isolation-Policy
   path, i.e. Chromium 137+.
5. **Keep reads reactive, not one-shot.** Balances and cells update as the chain and the
   cell tip advance. Use `useBalance` / `useLiveCells` / `useDaoDeposits` (they auto-watch
   the lock and re-query on `sync.cellTip`) instead of a single RPC call at mount.
6. **Expect delayed send feedback.** There is no mempool. `useSendTransaction` broadcasts
   over P2P and polls `getTransaction` until committed; surface `pending` in the UI and do
   not assume immediate rejection errors.
7. **Watch custom type scripts yourself.** The light client only indexes watched scripts.
   For assets under a custom type script, `client.watch(typeScript, "type")` (xUDT via a
   hook is on the roadmap).
8. **Drop assumptions about node-only RPCs.** `getBlockByNumber` / `getHeaderByNumber` /
   `get_live_cell` are not available and throw `UNSUPPORTED`; fee statistics fall back to
   the configured default rate. Audit any direct `client.*` calls your app made.
9. **Show sync state.** Drop in `SyncStatus`, or read `useLightClient().sync`, so users see
   `syncing-headers` / `syncing-cells` / `ready` and can retry after an `error`.
10. **Verify zero RPC.** Open DevTools → Network and confirm no JSON-RPC POSTs, only a
    `wss://` P2P socket. `e2e/no-rpc.spec.ts` asserts exactly this in headless Chromium.

## Loading and recovery

`@light-dapp-kit/core` imports `ckb-light-client-js` (the ~10 MB WASM + workers)
lazily on `start()`, so your app renders before the download begins; bundlers
split it into its own async chunk. In the demo this keeps the gzipped entry near
300 KB instead of several MB.

Boot and poll failures recover on their own. A few consecutive poll misses (peer
churn, a worker call racing a reload) are tolerated silently; past the threshold
the phase shows `error` and the client backs off exponentially but keeps polling,
so it heals as soon as the light client answers. Boot is retried the same way.
`SyncState.retry` carries the scheduled attempt and time; `client.retry()` (and
the Retry button in `SyncStatus`) skips the wait. Only `reset()` wipes local data.

## Things that differ from RPC mode

| Behaviour | RPC | Light client |
| --- | --- | --- |
| Mempool rejection feedback | immediate | delayed — poll `getTransaction` |
| Cells of un-watched addresses | queryable | empty; hooks auto-watch |
| Resolving a spent out point | node knows | for a watched script, `getCell` returns undefined (verified live), not a stale cell |
| Custom type script cell deps | node has them | `client.watch(typeScript, "type")` yourself |
| Fee estimation | `estimate_cycles` | works via light client, falls back to `defaultFeeRate` |

Cell sync is a linear scan of block filters from the watch start block to the
tip. Measured in CI (GitHub-hosted runner, Chrome headless, testnet): about 600
blocks per second, so the default 1,000-block look-back costs a couple of
seconds, 67,000 idle blocks did not finish within 9 minutes, and a scan from
genesis would take more than 10 hours. On reload the light client keeps its own sync progress, and the kit reconciles restored watches to it, so a refresh resumes instead of re-scanning. Always give `watch()` or
`watchFromBlock` a start close to the wallet's first activity, and never call
it with block 0 on a real network.

`client.blockForDate(date, safetyBlocks?)` estimates that start with zero RPC by interpolating between the light client's genesis and tip headers (it is an estimate — see `blockForDate.ts`), and `client.watchFromDate(script, type, date, safetyBlocks?)` watches from it:

```ts
// start the wallet's lock from roughly when the user first used it
await client.watchFromDate(lock, "lock", new Date("2024-06-01"), 10_000n);
```

Measured end to end in the same CI setup (`e2e/wallet.spec.ts`): headers synced
in 65–90 s with 6–8 peers; the balance page reached `ready` 135–195 s after
load with an explicit start block; a signed transfer was `pending` 2 s after
the click and `committed` 32–64 s later, of which about 23 s was the network's
own inclusion time.

## Cross-origin isolation

`SharedArrayBuffer` requires a cross-origin-isolated page. Two ways to get there,
and they are not equivalent:

- `Document-Isolation-Policy: isolate-and-require-corp` (Chromium 137+). Isolates
  the document only; popups you open keep `window.opener`, so popup-based wallets
  such as JoyID can post their result back. Prefer this.
- `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`
  (every browser). Puts cross-origin popups in a separate browsing context group:
  the popup sees `opener === null`, the opener sees `popup.closed === true`, and
  `@ckb-ccc/joy-id` fails with "Popup closed". Extension wallets are unaffected.

The template's `vite.config.ts` sends DIP to Chromium 137+ and COOP/COEP to everything
else. Static hosts use the bundled `coi-serviceworker.js`, which injects the same
per-browser headers (DIP on Chromium 137+, COOP/COEP otherwise), so JoyID works on GitHub
Pages too.

Verified empirically (Chrome 153, headless): COOP/COEP → `crossOriginIsolated`
true, JoyID opener null; DIP → `crossOriginIsolated` true, opener present;
`COOP: same-origin-allow-popups` → not isolated, light client cannot start.

## Known issues

Tracked in `e2e/upstream/` and the issues filed against `nervosnetwork/ckb-light-client`.
