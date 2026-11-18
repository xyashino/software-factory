---
status: todo
factory: v2
plan: factory-cli
depends_on: [cli-01-skeleton]
priority: high
line: feature
type: feat
---

# Todo: `cli-02-contracts` — Copy the Wire Contracts Into the CLI

## 🎯 Objective

Create `apps/factory/src/contracts/` with the Zod schemas for every route and every operator verb the CLI calls. The schemas are copied from the server, not imported, because shared contracts move to a package at the end (PLAN §7).

---

## 🌐 Context & Problem Statement

- The server defines its wire shapes in `apps/factory-server/src/contracts/*.contract.ts`. The CLI must send and parse exactly those shapes.
- The factory-server plan (`apps/factory-server/docs/PLAN.md` §9, §11) is the source of truth for routes, auth scopes and verb effects.
- Duplicating now is accepted (decision recorded in `apps/factory/docs/PLAN.md` §7). A later step moves them into one package.
- If a server contract changes, the copy must change in the same commit. A test in this step pins the shape so drift shows up as a failing test.

---

## 📦 Specification / Scope

- **Target**: `apps/factory/src/contracts/`
- **Classification**: `Integration` (shapes only, no I/O).
- **Source files to copy from** (read only, do not import):
  - `apps/factory-server/src/contracts/cells.contract.ts`
  - `apps/factory-server/src/contracts/jobs.contract.ts`
  - `apps/factory-server/src/contracts/queue.contract.ts`
  - `apps/factory-server/src/contracts/incidents.contract.ts`
  - `apps/factory-server/src/contracts/work-orders.contract.ts`
  - `apps/factory-server/src/contracts/order-plans.contract.ts`
  - `apps/factory-server/src/contracts/projects.contract.ts`
  - `apps/factory-server/src/contracts/common.ts`
  - `apps/factory-server/src/contracts/stream.contract.ts`
  - Operator wire shape: from `apps/factory/docs/PLAN.md` and `apps/operator/docs/PLAN.md` §3 (no server contract exists yet; see the server-drain step).
- **Files to create**:
  - `src/contracts/common.ts`
  - `src/contracts/cells.contract.ts` (enroll, hello, claims, heartbeats, list, revoke)
  - `src/contracts/jobs.contract.ts` (transitions: start, complete, fail, block, line_unavailable, worktree_missing)
  - `src/contracts/queue.contract.ts` (import, export, actions)
  - `src/contracts/work-orders.contract.ts` (list, show, transition)
  - `src/contracts/order-plans.contract.ts` (list)
  - `src/contracts/incidents.contract.ts` (list, resolve)
  - `src/contracts/stream.contract.ts` (SSE query: projectId, afterSeq)
  - `src/contracts/operator.contract.ts` (done, verdict pass, verdict fail, block, context, read, incident)
- **Dependencies**: `zod: catalog:` (added in cli-01).

---

## 🛠️ Implementation Plan

1. **Copy, then trim**: copy each server contract, keep only the fields the CLI sends or reads. Keep field names identical to the server.
2. **Strict bodies**: every request body schema uses `.strict()`. Extra fields are rejected on both sides.
3. **Operator contract**: one schema per verb. Fields:
   - `done`: `{ verb: 'done' }`
   - `verdict`: `{ verb: 'verdict', outcome: 'pass' | 'fail', feedback?: string }` (feedback required when outcome is `fail`, enforced with a `superRefine`)
   - `block`: `{ verb: 'block', reason: string, handover: string }` (file content, not a path)
   - `context`: `{ verb: 'context' }`
   - `read`: `{ verb: 'read' }`
   - `incident`: `{ verb: 'incident', action: 'retry_step' | 'restart_from_step' | 'restart_from_scratch' | 'escalate' | 'cancel', step?: string, diagnosis: string, outcome: string, report: string }`
   - `step` is required when `action` is `restart_from_step` (superRefine). This is syntax of the verb, so the CLI checks it too (see cli-07).
4. **Reply schemas**: `200` ok shape; `400` `invalid`; `401` `unauthorized`; `409` with `code` in `rejected | stale_epoch | not_live | precondition | already_applied`; `500` `internal`. Put them in `common.ts`.
5. **Do not** add any route the server does not have. `answer`, `tell` and `ask` have no contract (open, PLAN §8).

---

## ✅ Acceptance Criteria

- [ ] Every route in the CLI's command list (apps/factory PLAN §1) has a contract.
- [ ] Every request body schema is `.strict()`; an extra field fails to parse.
- [ ] `verdict` with outcome `fail` and no feedback fails to parse.
- [ ] `incident` with `restart_from_step` and no `step` fails to parse.
- [ ] A unit test per contract file: one valid body parses, one unknown key is rejected.
- [ ] A drift test compares each copied schema's field names with the server file (text match on the key list), so a server change fails the test.
- [ ] No `any`; no `unknown` used as a type; no barrel file.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`), noting the duplication and the later extraction.
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md): test output.
