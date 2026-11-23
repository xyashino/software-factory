---
scope: factory
summary: Drop dead SELF_FENCE_MS and old sf server hints
why: Factory copy of SELF_FENCE_MS was never read. Hints still named sf server, which is now sf hq.
date: 2026-11-23
tags: [factory, sf, cleanup]
---

- Removed `SELF_FENCE_MS` from `apps/factory/src/config.ts`. Live copy stays in `apps/sf/src/config.ts`, read by `hq-link.ts`.
- Hints from `sf` now name `sf hq start` and `sf hq token admin create --save [--global]`: doctor, web start, connection recovery and token fix.
- No logic change. `sf server` aliases still work.
- Every other exported constant in both `config.ts` files has a reader.
