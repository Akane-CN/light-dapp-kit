# Integration guide (draft, filled in during M3)

## Minimal change

Replace your `ccc.Provider` with `LightClientProvider`. Everything else stays.

## Things that differ from RPC mode

| Behaviour | RPC | Light client |
| --- | --- | --- |
| Mempool rejection feedback | immediate | delayed — poll `getTransaction` |
| Cells of un-watched addresses | queryable | empty; hooks auto-watch |
| Custom type script cell deps | node has them | `client.watch(typeScript, "type")` yourself |
| Fee estimation | `estimate_cycles` | works via light client, falls back to `defaultFeeRate` |

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
else. Static hosts use `coi-serviceworker`, which currently only emits COOP/COEP.

Verified empirically (Chrome 153, headless): COOP/COEP → `crossOriginIsolated`
true, JoyID opener null; DIP → `crossOriginIsolated` true, opener present;
`COOP: same-origin-allow-popups` → not isolated, light client cannot start.

## Known issues

Tracked in `e2e/upstream/` and the issues filed against `nervosnetwork/ckb-light-client`.
