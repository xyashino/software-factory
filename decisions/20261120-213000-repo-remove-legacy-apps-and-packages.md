---
scope: repo
summary: Remove legacy v2 apps, factory-* packages and their CI wiring
why: sf stack replaced them; BE_RULES already forbids importing them; they slowed install, turbo and PR CI
date: 2026-11-20
tags: [cleanup, monorepo, ci]
---

- Deleted `apps/cell`, `apps/cli`, `apps/server`, `apps/operator-cli`.
- Deleted `packages/factory-core`, `factory-db`, `factory-definitions`, `factory-runtime`.
- Root `package.json`: dropped `factory`, `factory-server`, `factory-cell` scripts.
- `pr-ci.yml`: dropped operator CLI budget step, `distributed`, `distributed-soak` jobs; `verify` kept.
- `pnpm-workspace.yaml`: dropped `ajv`, `fast-check` catalog entries; lockfile regenerated.
- README: dropped legacy CLI rows and setup section; `.prettierignore`: dropped factory-db path.
