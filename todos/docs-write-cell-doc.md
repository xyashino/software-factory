---
status: queued
priority: medium
line: standard
type: docs
depends_on: docs-restructure-root
---

# docs-write-cell-doc: document the Cell

## 🎯 Objective

Add `docs/cell.md`: what a Cell is, where it runs, how it talks to factory, operator and runners.

---

## 🌐 Context & Problem Statement

`apps/cell` has no docs. Cell behavior is spread across factory PLAN §3 (leases, takeover, worktrees), sf PLAN §3 (cell under the hood) and operator docs. Readers cannot tell which code runs a Cell (`apps/cell` cell-server vs `apps/sf/src/cell`).

---

## 📦 Specification / Scope

- **Target**: `docs/cell.md`, links from `docs/README.md`, `docs/architecture.md`
- **Classification**: `Universal Tooling`
- **Dependencies**: none
- Out: copying factory lease/worktree rules (link them), code changes.

---

## 🛠️ Implementation Plan

1. Read `apps/cell/src`, `apps/sf/src/cell` and the cell status recorded by `docs-fix-stale-facts`.
2. Write sections: role; two codepaths (cell-server vs `sf cell`) and when each runs; slots and runtime statuses; supervisor, workspace, runner flow; operator endpoint; settings and factory profiles; local data (`.cell`, sqlite).
3. Link, do not copy, factory §3 and operator verbs.
4. Caveman style, under ~150 lines.

---

## ✅ Acceptance Criteria

- [ ] `docs/cell.md` states which code runs a Cell and which app owns what.
- [ ] Every claim traceable to code read in step 1.
- [ ] Linked from index and architecture.
- [ ] One new ADR in `decisions/`.
- [ ] Passes verification gate (`pnpm ci:verify`).
