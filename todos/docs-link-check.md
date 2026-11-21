---
status: queued
priority: low
line: standard
type: feat
depends_on: docs-restructure-root
---

# docs-link-check: fail CI on dead doc links

## 🎯 Objective

Root script checks relative links in markdown; wired into `pnpm ci:verify`.

---

## 🌐 Context & Problem Statement

19 dead links went unnoticed. A check stops rot after restructure.

---

## 📦 Specification / Scope

- **Target**: `scripts/`, root `package.json`, `turbo.json`
- **Classification**: `Universal Tooling`
- **Dependencies**: none new (Node fs/path only)
- Out: external URL checks, anchor checks.

---

## 🛠️ Implementation Plan

1. `scripts/check-doc-links.ts`: scan `docs/**/*.md`, root `README.md`, `apps/*/README.md`, `packages/*/README.md`. Match `](relative)` links, skip `http`, `mailto`, `#`. Strip `#anchor`. Exit 1 listing `file -> link` for each missing target.
2. Root script `docs:check`; add `//#docs:check` to turbo and to `ci:verify` task list.
3. Exclude `decisions/` and `todos/` (historical, may link removed files).
4. Test with temp fixtures (good link, missing link, anchor, external): assert exit code and message.

---

## ✅ Acceptance Criteria

- [ ] `pnpm docs:check` passes on clean repo, fails on a planted dead link.
- [ ] Runs inside `pnpm ci:verify`.
- [ ] Tests: black box, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
