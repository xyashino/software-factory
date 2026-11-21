---
status: queued
priority: medium
line: standard
type: test
depends_on: install-fix-source-path
---

# onboarding-smoke-test: CI proves install and quickstart work

## Objective

A CI job builds `sf`, installs it with `scripts/install.mjs`, and runs the README quickstart in a clean checkout, so path and flow regressions fail a PR.

## Context

`pr-ci.yml` runs `turbo ... build` (package build scripts), not `build:sf`. `apps/sf/test/blackbox/standalone-external-repo.test.ts` needs `apps/sf/dist/sf` and web build, skips without them, and uses `install.sh`. So the broken `install.mjs` path shipped unnoticed. See `docs/onboarding-plan.md`.

## Scope

- **Target**: `.github/workflows/`, `apps/sf/test/blackbox/standalone-external-repo.test.ts`
- **Classification**: `Infrastructure`
- **Out of scope**: Windows, cell start (needs runner CLIs), changing `pr-ci.yml` verify job.

## Verify first

- Runtime of `pnpm build:sf` on `ubuntu-latest` vs workflow timeout.
- Where the test decides to skip, and that `CI=true` can turn skip into failure.
- Pin actions by commit sha like `pr-ci.yml`.

## Implementation Plan

1. **Files**: new `.github/workflows/onboarding.yml`; edit the blackbox test.
2. **Behavior**:
   - Workflow on PRs touching `scripts/`, `apps/sf/`, `apps/web-demo/`, root `package.json`: setup pnpm, Node 24, Bun as in `pr-ci.yml`; `pnpm install --frozen-lockfile`; `pnpm build:sf`; run the blackbox test.
   - Test: when `CI=true` and build output is missing, fail instead of skip. Install with `node scripts/install.mjs --prefix <tmp>` (keep `install.sh` check too) and run the installed `sf`.
3. **Integration**: none.

## Acceptance Criteria

- [ ] Reverting the `install-fix-source-path` change makes the job fail.
- [ ] Job passes on main and finishes inside its timeout.
- [ ] Test is not skipped in CI.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
