# Contributing

- `bun install` → `bun run typecheck` → `bun run test` before pushing.
- Upstream issues: when you hit a filable bug in `ckb-light-client`, `ckb-light-client-js` or `coi-serviceworker`, file it and add a `test.skip`-ed repro under `e2e/upstream/` with the issue URL. Track non-bug limitations in `e2e/upstream/README.md`.
- AI assistance is welcome; disclose which parts were AI-generated in the PR description. Keep `packages/core/src/client.ts` overrides hand-reviewed.
