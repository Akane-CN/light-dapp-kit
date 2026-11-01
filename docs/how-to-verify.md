# How to verify

One page for reviewers. The claim is **the dApp reads and writes CKB from the browser with
zero JSON-RPC** — every check below is either a CI assertion you can re-run or a one-minute
manual look. Nothing here needs trust in a screenshot.

## See it yourself (1 minute, no checkout)

1. Open the reference wallet (GitHub Pages link in the repo description).
2. Open DevTools → Network, filter **Fetch/XHR**.
3. Connect a wallet, wait for `ready`, open the Balance page.
4. There must be **zero** HTTP JSON-RPC requests — only a `wss://` P2P socket. The on-page
   "Foreign HTTP fetch/XHR" meter should stay at 0.

## Run the suite yourself

```sh
bun install
bunx playwright install --with-deps chromium
bun run test        # unit: @light-dapp-kit/core (26) + /react (25) + scaffold smoke
bun run e2e -- no-rpc.spec.ts     # the zero-RPC canary (testnet, ~2 min)
```

The network e2e specs talk to real testnet peers, so they take a few minutes each.

## What each check proves

| Check | Asserts | Run it | In CI |
| --- | --- | --- | --- |
| `no-rpc.spec.ts` | syncs to `ready` on testnet; **zero** foreign JSON POSTs; at least one P2P websocket | `bun run e2e -- no-rpc.spec.ts` | every push/PR (`e2e`) |
| `connector.spec.ts` | real CCC connector UI → injected EIP-6963 wallet → Omnilock address, `personal_sign`, balance read; zero RPC, no funds | `bun run e2e -- connector.spec.ts` | push to `main` (`e2e-connector`) |
| `wallet.spec.ts` | on testnet: balance, Nervos DAO list, a real 100 CKB self-transfer broadcast over P2P and polled to `committed`; zero RPC | `TESTNET_PRIVATE_KEY=0x… bun run e2e -- wallet.spec.ts` | push to `main` (`e2e-wallet`) |
| `joyid.spec.ts` | canary: drives the real JoyID popup with a virtual authenticator; `credentials.create()` succeeds and JoyID's AAGUID gate still holds | `RUN_JOYID=1 bun run e2e -- joyid.spec.ts` | weekly + manual + `[joyid]` commits (`e2e-joyid`) |
| `bun run test` | adapter retry/backoff, sync state machine, watch reconcile, date→block estimate, all React hooks | `bun run test` | every push/PR (`unit`) |

Notes:

- The e2e web server builds the demo with `VITE_ALLOW_TEST_SIGNER=1`, which enables the
  injected private-key signer and EIP-6963 test wallet. Production builds compile that branch
  out (verified: zero references in the prod bundle), so the test hooks never ship.
- `wallet.spec.ts` defaults `TESTNET_PRIVATE_KEY` to the community's public testnet key
  (`0xee…ee`); set the secret to use your own. It tops the address up from the faucet when it
  runs low and starts cell sync just before the address's latest activity.
- `joyid.spec.ts` **passes** while JoyID rejects the virtual authenticator by AAGUID and
  **fails** the day JoyID accepts it — that failure is the signal to turn it into a real
  integration test. Automating the JoyID connection fully would require forging attestation
  metadata, which this project does not do; the JoyID connection stays a manual check.

## Measured numbers (from CI, headless Chromium, testnet)

| Metric | Value |
| --- | --- |
| Header sync to tip | 65–90 s, 6–8 peers |
| Balance page `ready` (explicit start block) | 135–195 s |
| Send: click → `pending` | ~2 s |
| Send: `pending` → `committed` | 32–64 s (~23 s of it is network inclusion) |
| Cell-filter scan throughput | ~600 blocks/s |

The self-transfers are real and on-chain; recent CI runs produced e.g.
`0x8cd41552aabc6f3db857dbab68a2145e37360b22bcd32a4f3a3266003a427563` and
`0xe486aba100859146478a1992c0cede698b6483da3f925f01a0abbcbf8a7e1726`
(pudge.explorer.nervos.org).

## Manual checks (not in CI)

- **JoyID connect:** Chrome with a synced passkey, or macOS with Touch ID, on the Pages demo
  — connect JoyID and confirm the address and a signed transfer. CI cannot do this (see the
  joyid canary note).
- **Mainnet:** the client binds to the mainnet CCC base class (`ckb` addresses, mainnet
  known scripts). The CI e2e run on testnet; a mainnet read-only check is an M1 deliverable.
