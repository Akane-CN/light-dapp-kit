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

`SharedArrayBuffer` requires COOP/COEP. Vite dev/preview set the headers; static hosts use `coi-serviceworker`.

## Known issues

Tracked in `e2e/upstream/` and the issues filed against `nervosnetwork/ckb-light-client`.
