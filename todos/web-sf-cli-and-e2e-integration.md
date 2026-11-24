---
status: queued
priority: medium
line: standard
type: feat
plan: web-eda
depends_on: web-incidents-module
---

# web-sf-cli-and-e2e-integration: wire apps/web into sf web start and Playwright a11y E2E

## Objective

Make `sf web start` and `build:sf` able to serve `@repo/web` alongside or in place of `@repo/web-demo`, and add Playwright + `@axe-core/playwright` E2E and accessibility coverage for `apps/web`.

## Context

`package.json` `build:sf`, `scripts/deploy-web-deps.mjs`, and `apps/sf` currently package only `apps/web-demo`. Adding E2E + axe-core checks (matching Parka's Playwright setup) guards interactive UI, keyboard navigation, dark mode, and WCAG 2.2 accessibility before retiring `apps/web-demo`.

## Scope

- **Target**: `package.json`, `scripts/deploy-web-deps.mjs`, `apps/sf/src/adapters/cli/web.command.ts`, `apps/web/playwright.config.ts`, `apps/web/test/e2e`, `.github/workflows/pr-ci.yml`
- **Classification**: `Integration`, `Testing`, `CI`
- **Out of scope**: Removing `apps/web-demo` (keep both until all modules in `plan: web-eda` ship).

## Implementation Plan

1. **CLI & Packaging**:
   - Allow `sf web start` to select the EDA app (`--app web` or default once ready, preserving `--app demo` fallback) and update `scripts/deploy-web-deps.mjs` to bundle `@repo/web` runtime deps.
2. **Playwright + Axe E2E (`apps/web`)**:
   - Add `playwright.config.ts` and E2E specs covering Overview, Work Orders (list, filter, detail, resume, cancel confirm dialog), Incidents triage, dark mode toggle, keyboard navigation, and `@axe-core/playwright` zero-violation checks.
3. **CI**:
   - Wire `@repo/web` Playwright suite into `.github/workflows/pr-ci.yml` (or dedicated workflow job).

## Acceptance Criteria

- [ ] `sf web start` can launch `@repo/web` against a running HQ with loopback auto-registration.
- [ ] Playwright E2E + axe-core specs pass with zero critical/serious accessibility violations.
- [ ] `apps/web-demo` continues to build and pass tests without regression.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
