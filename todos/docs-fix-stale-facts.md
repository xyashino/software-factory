---
status: queued
priority: high
line: fast
type: docs
depends_on: operator-retire-app-and-protocol
---

# docs-fix-stale-facts: correct wrong names and claims in app docs

## 🎯 Objective

Docs match the repo: real app and package names, real cell status, resolved `factory-` prefix rule.

---

## 🌐 Context & Problem Statement

sf PLAN says Cell app removed; `apps/cell` exists. sf PLAN §7 cites a "no `factory-` prefix" operator boundary rule not found in operator docs; it blocks the name `@repo/factory-contracts`. Wrong docs mislead agents. See `docs/docs-plan.md`.

---

## 📦 Specification / Scope

- **Target**: `apps/sf/docs`, `apps/factory/docs`, `apps/web-demo/docs`
- **Classification**: `Universal Tooling`
- **Dependencies**: none
- Out: moving files, deleting sections, new docs.

---

## 🛠️ Implementation Plan

1. **Names**:
   - Operator app and its docs are removed by `operator-retire-app-and-protocol`; operator name fixes are moot. Verify none remain.
   - Root `README.md` still says "Workers" and "Cycle"; code and docs say Cell and Job. Fix text. Env var `FACTORY_CYCLE_TOKEN` keeps its name here; record rename as open decision in ADR.
   - Remove `.tmp/omino-api` and `packages/factory-*` mentions in factory docs; fix operator README "step-01..07" todo reference.
   - sf `PLAN.md` title says "`factory` CLI": fix to `sf`.
2. **Cell status**: read `apps/cell/src`, `apps/sf/src/cell`, `git log --oneline -- apps/cell apps/sf/src/cell`. Decide from code: is `apps/cell` (cell-server) live, optional, or legacy. Fix sf PLAN §8 decision 2 and any "legacy Cell app removed" text. Note in ADR what was found.
3. **`factory-` prefix rule**: search `git log -S"forbids that prefix"`, `todos` history, `.nitpick`, eslint config for the rule. Found: document it where it lives and state exact scope. Not found: remove the claim from sf PLAN §7. Record outcome for `docs/contracts-plan.md`; update its package-name text if rule is real.
4. **sf PLAN §7**: point to `docs/contracts-plan.md` instead of "name not yet chosen".

---

## ✅ Acceptance Criteria

- [ ] `grep -rn "operator-cli\|factory-operator\|omino-api\|packages/factory-" apps docs README.md` returns nothing.
- [ ] sf PLAN states cell status that matches code.
- [ ] `factory-` prefix claim sourced or removed; contracts plan name reconciled.
- [ ] One new ADR in `decisions/`.
- [ ] Passes verification gate (`pnpm ci:verify`).
