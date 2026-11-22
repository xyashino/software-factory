---
scope: repo
summary: Fix install script default source to apps/sf/dist
why: The dirs rename left install.mjs on the old dist dir, so pnpm install:sf failed on a clean VPS after build:sf.
date: 2026-11-21
tags: [install, build, onboarding]
---

- `scripts/install.mjs` `DEFAULT_SOURCE` now points at `apps/sf/dist`, where `build:sf` writes `sf`.
  - `--source` override and the missing-binary error text are unchanged.
- Install blackbox test binary path updated to `apps/sf/dist/sf`, the same stale path.
- `docs/onboarding-plan.md` note updated to record the fix.
- Windows lookup unchanged: `sf.exe` then `sf` in the same `apps/sf/dist`.
