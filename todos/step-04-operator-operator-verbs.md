---
status: todo
factory: v2
plan: operator-cli
depends_on: [step-03-operator-define-verb-cli]
priority: high
line: feature
type: feat
---

# Todo: `step-04-operator-operator-verbs` — Operator Verbs

## 🎯 Objective

Implement the verbs an Operator agent uses: `done`, `verdict pass`, `verdict fail`, `block`, and `context`.

---

## 🌐 Context & Problem Statement

- Verbs and options are in `apps/operator/docs/PLAN.md` §3.1.
- `context` is kept or dropped depending on PLAN §8 item 2 (open). Build it only if it is kept.
- The server decides the transition for each verb. The CLI only sends the verb and its files.

---

## 📦 Specification / Scope

- **Target**:
  - `apps/operator/src/verbs/operator/done.ts`
  - `apps/operator/src/verbs/operator/verdict.ts` (`pass`, `fail`)
  - `apps/operator/src/verbs/operator/block.ts`
  - `apps/operator/src/verbs/operator/context.ts` (only if kept)
  - `apps/operator/src/__tests__/verbs-operator.test.ts`
- **Boundary**: `apps/operator/src/verbs/operator/` and the test file. Reuse `defineVerb` from step-03.
- **Classification**: `Black-box` through the stub Cell.
- **Options**:
  - `done`: none
  - `verdict pass`: none
  - `verdict fail --feedback <file>` (`-` reads stdin)
  - `block --reason "<why>" --handover <file>`
  - `context`: none, read-only

---

## 🛠️ Implementation Plan

1. `done`: `toRequest` builds `{ verb: 'done' }`.
2. `verdict pass` and `verdict fail` are two verbs under one `verdict` command, with `fail` requiring `--feedback`.
3. `block`: `--reason` and `--handover` both required; the handover file is read and sent as text.
4. `context`: read-only; the request carries no mutating field. Skip this item if PLAN §8 item 2 drops it.
5. One black-box test per verb through the stub Cell.

---

## ✅ Acceptance Criteria

- [ ] `verdict fail` without `--feedback` gives exit `2` and sends no request.
- [ ] `block` without `--reason` gives exit `2` and sends no request.
- [ ] `block` without `--handover` gives exit `2` and sends no request.
- [ ] `done` and `verdict pass` send exactly one request each.
- [ ] `context` sends no mutating field (only if built).
- [ ] Each verb has at least one black-box test through the stub Cell.
- [ ] No `any`; no barrel file.
- [ ] `pnpm --filter @repo/factory-operator-cli check-types`, `lint`, `test` pass.
- [ ] One new ADR entry in `decisions/`.
- [ ] Evidence recorded per `.agents/skills/evidence/SKILL.md`.
