---
scope: factory/hq
summary: Rename contracts package to hq-contracts
why: Contracts describe HQ routes, so the package name must say HQ, not factory.
date: 2026-11-23
tags: [factory, hq, rename, contracts]
---

- `git mv packages/factory-contracts packages/hq-contracts`. Package `@repo/factory-contracts` is now `@repo/hq-contracts`; imports, `workspace:*` deps and `bun.lock` refreshed.
- Imports in `apps/hq`, `apps/sf`, `apps/web-demo` and their tests use `@repo/hq-contracts/...`. Subpaths and file names (`cells.contract.ts`) unchanged.
- `docs/sf.md` and `todos/*` name `packages/hq-contracts`. `factory-contracts` grep is clean outside `decisions/`.
- Unchanged: contract shapes, routes, env vars, DB and HTTP behaviour. No behaviour change.
- Prettier re-wrapped three imports that now fit on one line.
- Checks: `ci:verify` (34 tasks) passes.
