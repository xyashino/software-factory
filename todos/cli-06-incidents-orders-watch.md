---
status: todo
factory: v2
plan: factory-cli
depends_on: [cli-05-todos-and-queue]
priority: medium
line: feature
type: feat
---

# Todo: `cli-06-incidents-orders-watch` — Supervisor Incident, Order and Live Commands

## 🎯 Objective

Give the Supervisor the commands to see and resolve incidents, inspect and change one Work order, and watch the live transition stream.

---

## 🌐 Context & Problem Statement

- Incidents are the Supervisor's escalation path (factory-server PLAN §4). Without `incident list` and `resolve`, a blocked Work order can only be fixed through raw HTTP.
- `order show` and `order resume|reopen|cancel` cover the Work order transitions the server exposes (PLAN §9).
- `watch` is the only live view (PLAN §9). It must resume from the last event after a reconnect, so no transition is lost.

---

## 📦 Specification / Scope

- **Target**: `apps/factory/src/application/procedures/incidents/`, `procedures/work-orders/`, `procedures/watch/`, matching `adapters/cli/*.command.ts`.
- **Classification**: `Integration`.
- **Files to create**:
  - `src/application/procedures/incidents/list.procedure.ts`, `resolve.procedure.ts`
  - `src/application/procedures/work-orders/show.procedure.ts`, `transition.procedure.ts`
  - `src/application/procedures/watch/stream.procedure.ts`
  - `src/adapters/cli/incident.command.ts`, `order.command.ts`, `watch.command.ts`
  - `src/adapters/http/sse-client.ts` (reads `text/event-stream`, yields parsed events, reconnects with `afterSeq`)
  - `test/blackbox/incidents-orders.test.ts`, `test/blackbox/watch.test.ts`
- **Dependencies**: none added.

---

## 🛠️ Implementation Plan

1. **`factory incident list [--project] [--order] [--reason] [--status]`**: `GET /api/v1/incidents` with filters. Table: id, reason, order, status, triage owner.
2. **`factory incident resolve <id> --action <retry_step|restart_from_step|restart_from_scratch|escalate|cancel> [--step <id>] [--report <file>]`**:
   - `--step` is required for `restart_from_step` (CLI syntax check, exit `2`).
   - `--report <file>` is read as text and sent as content. The server stores it.
   - `POST /api/v1/incidents/{id}/resolve` with `supervisor:write`.
   - The server decides whether the action is valid for the incident reason; the CLI does not repeat that rule.
3. **`factory order show <id>`**: `GET /api/v1/work-orders/{id}`. Print state, line, steps with state, jobs, incidents. `--json` prints the raw body.
4. **`factory order resume|reopen|cancel <id>`**: `POST /api/v1/work-orders/{id}/transitions` with `{ action }`. `cancel` requires `--yes`, as in cli-05.
5. **`factory watch [--project] [--after <seq>]`**:
   - `GET /api/v1/stream?projectId=...&afterSeq=...` with `Accept: text/event-stream`.
   - Prints one line per event: seq, time, order, kind, summary.
   - On disconnect, reconnects with the last seen `seq` after 1 s, 2 s, 4 s, capped at 10 s. Each reconnect uses the same `afterSeq` value, so no event is printed twice.
   - Ctrl-C exits `0`.
6. **Help text** for each command lists its options and the scope it needs.

---

## ✅ Acceptance Criteria

- [ ] `incident resolve --action restart_from_step` without `--step` exits `2` and sends no request.
- [ ] `incident resolve --report` reads the file and sends its content, not its path.
- [ ] `order cancel` without `--yes` sends no request and exits `2`.
- [ ] `watch` reconnects with `afterSeq` set to the last printed `seq`.
- [ ] A test replays a dropped stream and checks no duplicate `seq` is printed.
- [ ] No barrel file; no `any`.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md): a short `watch` capture against a fake stream.
