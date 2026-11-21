---
scope: ci
summary: Add CI job that installs sf and runs the quickstart smoke test
why: Install path regressions shipped unnoticed because pr-ci.yml never runs install.mjs or the quickstart.
date: 2026-11-21
tags: [ci, install, onboarding]
---

- New `.github/workflows/onboarding.yml` runs on PRs to main touching `scripts/`, `apps/sf/`, `apps/web-demo/` or `package.json`.
  - Steps: pnpm, Node 24, Bun, `pnpm install --frozen-lockfile`, `pnpm build:sf`, then the blackbox test. Actions pinned by sha as in `pr-ci.yml`.
  - Timeout 30 min. Local `build:sf` takes about 4 s, blackbox test about 40 s.
- Blackbox test `standalone-external-repo.test.ts` installs with `node scripts/install.mjs --prefix <tmp>` and runs the installed `sf`.
  - New case: `install.sh` installs the same binary into its own prefix.
- With `CI=true`, a missing sf build fails the suite instead of skipping it.
