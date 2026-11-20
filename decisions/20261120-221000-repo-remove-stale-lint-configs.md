---
scope: repo
summary: Remove stale factory-* import guards from eslint configs and rule docs
why: packages and apps they guarded against were deleted; guards were dead config
date: 2026-11-20
tags: [cleanup, lint, docs]
---

- `packages/prompt/eslint.config.mjs`: dropped `@repo/factory-db`, `@repo/factory-core/cycle` restricted imports.
- `apps/factory-server/eslint.config.mjs`: dropped `LEGACY` pattern; layering rules (HTTP, ADAPTERS, BOOTSTRAP, domain/db/contract) kept.
- `BE_RULES.md` §1.2, operator `IMPLEMENTATION_RULES.md`: no longer name deleted apps/packages.
- `.prettierignore`: already clean (factory-db path removed earlier); `.cell` kept.
