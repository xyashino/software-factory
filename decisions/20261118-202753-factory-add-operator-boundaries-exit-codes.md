---
scope: factory/operator-boundaries
summary: Add operator boundary guards and exit-code tests
why: Boundary rules were prose only; a regex on path text missed package names and side-effect imports. Each exit code needs a CLI case.
date: 2026-11-18
tags: [factory, operator, cli, boundaries, exit-codes, tests]
---

- Operator boundary test (`apps/operator/src/__tests__/boundaries.test.ts`) scans every `.ts` under `apps/operator/src`.
  - Catches `from`, side-effect `import '...'` and dynamic `import('...')` specifiers.
  - Relative imports resolve to real paths; bare imports match `@repo/factory-*`.
  - Forbidden: `apps/cell`, `apps/factory-server`, `apps/server`, `apps/worker`, `apps/operator-cli`, `packages/factory-*`.
- Protocol boundary test (`packages/operator-protocol/src/__tests__/boundaries.test.ts`) moved out of the operator package.
  - Loads protocol sources as raw text via `import.meta.glob`, so the test needs no Node import.
  - Skips `__tests__`. Forbidden: `process`, `node:process`, `fs`, `node:fs`, `fs/promises`, `net`, `node:net`.
- `cli.test.ts` gains black-box exit `1`: stub Cell refuses with 409 `stale_epoch`, CLI prints `stale_epoch: <message>`, one request sent.
- Exit `0`, `2`, `3` already had black-box cases; all four codes are now covered through `runCli`.
- No source change. Both boundary tests pass on current code.
- Negative check: forbidden imports added by hand to operator source and protocol source; boundary tests went red; both reverted.
- Gate: test, check-types, lint green on `@repo/operator` and `@repo/operator-protocol`. `format:check` green.
- `nitpick:check` decision-log count is branch-wide: 5 entries from earlier steps on this branch, plus this one.
