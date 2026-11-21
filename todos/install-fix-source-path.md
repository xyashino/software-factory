---
status: queued
priority: high
line: fast
type: fix
---

# install-fix-source-path: install script looks in wrong dist dir

## Objective

`pnpm install:sf` finds the built binary at `apps/sf/dist`.

## Context

`scripts/install.mjs:19`: `DEFAULT_SOURCE = join(ROOT, 'apps/factory/dist')`. `build:sf` writes `apps/sf/dist/sf`; `scripts/install.sh` already uses `apps/sf/dist/sf`. Rename #191 missed this line. Result on a clean VPS: "missing .../apps/factory/dist/sf: run pnpm build:sf first". See `docs/onboarding-plan.md`.

## Scope

- **Target**: `scripts/install.mjs`
- **Classification**: `Infrastructure`
- **Out of scope**: install script tests (see `onboarding-smoke-test`), Windows layout changes.

## Verify first

- `SOURCE_BIN_NAMES` (`sf.exe`, `sf`) resolve in the same `apps/sf/dist` on Windows.
- Other stale `apps/factory/dist` references: `grep -rn "apps/factory/dist" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=decisions`.

## Implementation Plan

1. **Files**: `scripts/install.mjs` set `DEFAULT_SOURCE` to `apps/sf/dist`. Fix any other hit from the grep (README, docs).
2. **Behavior**: none else. Keep `--source` override and error text.

## Acceptance Criteria

- [ ] After `pnpm build:sf`: `node scripts/install.mjs --prefix "$(mktemp -d)"` succeeds and `<prefix>/bin/sf --help` runs.
- [ ] No `apps/factory/dist` left outside `decisions/`.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
