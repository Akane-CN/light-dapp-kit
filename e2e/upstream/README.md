# Upstream limitations and repros

Issues we hit in `ckb-light-client` / `ckb-light-client-js` / `coi-serviceworker`, how the
kit works around each, and (when filable as a bug) a `test.skip`-ed repro here that flips to a
regression test once the fix ships. See `CONTRIBUTING.md` for the policy.

Current status — limitations encountered, none yet filed as upstream bugs:

| Area | What we hit | Workaround in the kit | Filable? |
| --- | --- | --- | --- |
| `ckb-light-client-js@1.0.3` | bundles its own `@ckb-ccc/core@0.1.0-alpha.6`; two copies coexist with the app's current CCC | cast once at the adapter boundary (`toLcTx`) | yes — propose a peer dependency |
| `ckb-light-client` protocol | no `get_block` / `get_header_by_number` / `get_live_cell` | those methods throw a clear `UNSUPPORTED`; `getCellLive` rebuilds from the creating tx and verifies liveness for watched scripts | design question, not a bug |
| Cell/filter sync | linear scan (~600 blocks/s measured); no coarse skip for a cold start block | require an explicit watch start; `watchFromDate` is a proposed M2 feature | design proposal |
| `coi-serviceworker` | emitted only COOP/COEP, which breaks popup wallets | the kit ships its own worker that emits `Document-Isolation-Policy` on Chromium 137+ | yes — upstream PR planned |

When a limitation is filed as a bug, add `<slug>.spec.ts` here: a `test.skip` reproducing it
with the issue URL in the skip reason, so it runs green (skipped) until the fix lands.
