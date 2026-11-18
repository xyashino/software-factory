---
status: todo
factory: v2
plan: operator-cli
depends_on: [step-06-operator-boundaries-exit-codes]
priority: medium
line: fast
type: chore
---

# Todo: `step-07-retire-operator-cli` — Retire the Old Operator CLI

## 🎯 Objective

Delete `apps/operator-cli` and every reference to it, once the new CLI in `apps/operator` is green.

---

## 🌐 Context & Problem Statement

- `apps/operator-cli` (`@repo/factory-operator-cli`, binary `factory-operator`) has the old verb set: `ask`, `tell`, `escalate`, `incident --change`, and old incident actions. `apps/operator/docs/PLAN.md` §8 says to migrate it.
- The binary name is decided before this step (`apps/operator/docs/PLAN.md` §9). If the new binary is also named `factory-operator`, the package name changes, not the binary.
- Retirement follows the same pattern as the v1 removal todo: delete, then fix references.

---

## 📦 Specification / Scope

- **Target**:
  - `apps/operator-cli/` (whole directory)
  - root `package.json` scripts that point at it
  - any doc that names `apps/operator-cli` or `factory-operator` as the current binary
- **Boundary**: removal and reference updates only. No new behaviour.
- **Dependencies**: none added or removed, except the lockfile importer, which `pnpm install` updates.

---

## 🛠️ Implementation Plan

1. Confirm step-06 is green on `apps/operator`.
2. `git rm -r apps/operator-cli`.
3. Remove root scripts and references that point at it.
4. Update docs that name the old package as current (`apps/operator/docs/README.md` §Name, PLAN §9).
5. `pnpm install` to refresh `pnpm-lock.yaml`.

---

## ✅ Acceptance Criteria

- [ ] `apps/operator-cli/` is absent.
- [ ] `git grep -n "apps/operator-cli\|@repo/factory-operator-cli" -- ':!decisions' ':!todos'` returns nothing, or only the name of the new package.
- [ ] `pnpm-lock.yaml` has no `apps/operator-cli` importer.
- [ ] `pnpm install --frozen-lockfile` passes.
- [ ] `pnpm nitpick:check` and `pnpm format:check` pass.
- [ ] One new ADR entry in `decisions/`.
- [ ] Evidence recorded per `.agents/skills/evidence/SKILL.md`.
