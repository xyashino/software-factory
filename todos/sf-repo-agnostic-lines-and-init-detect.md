---
status: queued
priority: high
line: feature
type: feat
plan: universal-engine
depends_on: sf-forge-andon-issue-and-draft-pr
---

# sf-repo-agnostic-lines-and-init-detect: embed repo-agnostic lines and auto-detect stack in sf init

## Objective

Make built-in production lines (`fast`, `standard`, `feature`) 100% repo-agnostic inside `apps/sf`, expand `.factory/config.json` into a 1-file repo manifest (`workspace.setup`, `checks`, `context`, `git`), and make `sf init` auto-detect stack, CI commands, installed runners, and git forge so any repo injects cleanly with one config file.

## Context

Verified current behavior:

- `apps/sf/src/domain/init/templates.ts` hardcodes `bun install --frozen-lockfile`, `bun run --if-present lint|check-types|test`, `runner: claude`, `model: sonnet`, `headless: false`, and writes full `.factory/lines/*.yml` copies into every target repo.
- `apps/sf/src/domain/repo-config/parse-repo-config.ts` only parses `project`, `rules`, `skills` (plus `git` from `sf-gitlab-provider`).
- `apps/sf/src/domain/line/parse-line.ts` parses local `.factory/lines/<line>.yml` directly with no repo-hook interpolation or built-in line fallback.
- `apps/sf/src/adapters/runners/registry.ts` already registers `claude`, `codex`, `copilot`, `cursor`, `opencode`, `antigravity`.

## Scope

- **Target**: `apps/sf`
- **Classification**: `Domain Core`, `Feature`
- **Dependencies**: none
- **Out of scope**: `ROLE.md` built-ins and runtime guards (`sf-universal-role-md-and-guards`), remote/org blueprint registry (`extends:`).

## Implementation Plan

1. **Repo Manifest Schema (`apps/sf/src/domain/repo-config/parse-repo-config.ts`)**:
   - Extend `RepoConfig` (keeping existing fields backwards compatible):
     - `workspace?: { sync?: string[]; setup?: string[] }`
     - `checks?: { quick?: string[]; verify?: string[] }`
     - `context?: { rules?: string[]; conventions?: string[] }`
     - `defaults?: { runner?: string; model?: string; headless?: boolean }`
2. **Built-in Repo-Agnostic Lines (`apps/sf/src/domain/line/`)**:
   - Embed universal `fast`, `standard`, `feature` lines in `apps/sf` binding abstract hooks (`workspace.setup` -> `repo.workspace.setup`, `quality-gate` -> `repo.checks.verify`, operator runner/model -> `repo.defaults`).
   - Resolution order on job start (`run-job.procedure.ts`): repo `.factory/lines/<name>.yml` (if present, backwards compatible) -> user pack `$XDG_CONFIG_HOME/sf/lines/<name>.yml` -> built-in engine line.
3. **Auto-Detection in `sf init` (`apps/sf/src/domain/init/detect-repo.ts`, `init.procedure.ts`)**:
   - Detect package manager / stack and default `setup` + `checks.verify`:
     - Node/JS: `bun.lock` (`bun`), `pnpm-lock.yaml` (`pnpm`), `yarn.lock` (`yarn`), `package-lock.json` (`npm`) reading `package.json` scripts (`lint`, `typecheck`/`check-types`, `test`).
     - Python: `pyproject.toml` (`uv sync` / `pytest`, `ruff`).
     - Go: `go.mod` (`go test ./...`).
     - Rust: `Cargo.toml` (`cargo test`).
     - Fallback: `Makefile` targets or empty `checks.verify` with clear warning.
   - Detect existing repo rules files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `CONTRIBUTING.md`).
   - Detect available runner CLI on `PATH` (`claude`, `codex`, `opencode`, `antigravity`, `copilot`, `cursor`), defaulting `headless: true` when `herdr` is absent.
   - Write minimal `.factory/config.json` only (skip copying boilerplate lines/operators unless `--eject-lines` passed).
4. **Tests**:
   - Unit tests for stack/runner/rules detection across Bun, pnpm, Python, Go, Rust, and unknown repos.
   - Black-box tests for `sf init` generating 1-file manifest and Cell resolving built-in lines bound to repo manifest hooks.

## Acceptance Criteria

- [ ] `sf init` auto-detects stack, verify commands, existing rules files, installed runner, and git forge, generating minimal `.factory/config.json`.
- [ ] Built-in repo-agnostic lines (`fast`, `standard`, `feature`) execute using repo manifest hooks without requiring copied `.factory/lines/*.yml`.
- [ ] Existing repos with custom `.factory/lines/*.yml` continue working unchanged (override precedence).
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
