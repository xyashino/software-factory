---
status: todo
factory: v2
plan: operator-cli
depends_on: [step-04-operator-operator-verbs]
priority: high
line: feature
type: feat
---

# Todo: `step-05-operator-mechanic-verbs` — Mechanic Verbs

## 🎯 Objective

Implement the verbs a Mechanic agent uses on an incident: `read` and `incident`.

---

## 🌐 Context & Problem Statement

- Verbs and options are in `apps/operator/docs/PLAN.md` §3.2.
- `escalate` is `incident --action escalate`. There is no separate command.
- `answer` is **not** in this step. It depends on PLAN §8 item 1 (no question entity exists in the new core). A follow-up todo will add it after that decision.
- `--diagnosis` and `--outcome` are listed in PLAN §3.2 but PLAN does not say whether they are required. Confirm before building the required check; until then, pass them through when given.

---

## 📦 Specification / Scope

- **Target**:
  - `apps/operator/src/verbs/mechanic/read.ts`
  - `apps/operator/src/verbs/mechanic/incident.ts`
  - `apps/operator/src/__tests__/verbs-mechanic.test.ts`
- **Boundary**: `apps/operator/src/verbs/mechanic/` and the test file. Reuse `defineVerb` from step-03.
- **Classification**: `Black-box` through the stub Cell.
- **Options**:
  - `read`: none, read-only
  - `incident --action <retry_step|restart_from_step|restart_from_scratch|escalate|cancel> [--step <step-id>] [--diagnosis "<what happened>"] [--outcome "<what he tried>"] --report <file>`
- `--step` is required only for `restart_from_step`. The CLI checks presence only; step validity is the server's job (PLAN §5).
- `--report` is required for every `incident`, including `escalate`.

---

## 🛠️ Implementation Plan

1. `read`: no options; the request carries no mutating field.
2. `incident`: `--action` is a zod enum of the five values. `--step` is required when the action is `restart_from_step`, checked by presence only.
3. `--report` is read as UTF-8 and sent as text. `--diagnosis` and `--outcome` are passed through when given.
4. One black-box test per action and per refusal case through the stub Cell.

---

## ✅ Acceptance Criteria

- [ ] `incident` with an action outside the five values gives exit `2` and sends no request.
- [ ] `incident --action restart_from_step` without `--step` gives exit `2` and sends no request.
- [ ] `incident` without `--report` gives exit `2` and sends no request.
- [ ] `incident` sends `--diagnosis` and `--outcome` in the request when given.
- [ ] `read` sends no mutating field.
- [ ] No `answer` command is registered in this step.
- [ ] `pnpm --filter @repo/factory-operator-cli check-types`, `lint`, `test` pass.
- [ ] One new ADR entry in `decisions/`.
- [ ] Evidence recorded per `.agents/skills/evidence/SKILL.md`.
