---
status: todo
factory: v2
plan: factory-cli
depends_on: [server-drain-endpoint]
priority: high
line: feature
type: feat
---

# Todo: `cli-11-cell-stop-drain` — `factory cell stop` With a Clean Handover

## 🎯 Objective

Implement `factory cell stop --id <id>`: the Supervisor drains a Cell, the Cell finishes or hands over its Job, then leaves. `--force` skips the finish and hands over at once.

---

## 🌐 Context & Problem Statement

- `factory cell stop` is in the command table (`apps/factory/docs/PLAN.md` §1), and the plan has no working version until the server routes exist (server-drain-endpoint).
- Stopping must not lose work silently. The default waits for the Job to end in a station, so the agent can finish, then hands over.
- `server stop` never stops Cells (PLAN §8.4). `cell stop` is the only command that drains one.

---

## 📦 Specification / Scope

- **Target**: `apps/factory/src/application/procedures/cell/stop.procedure.ts`, `apps/factory/src/cell/drain-signal.ts`, `apps/factory/src/adapters/cli/cell.command.ts`.
- **Classification**: `Integration` and `Domain Core` (drain policy).
- **Files to create or change**:
  - `src/application/procedures/cell/stop.procedure.ts` (supervisor side: calls drain)
  - `src/cell/drain-signal.ts` (Cell side: reacts to `signals: ['drain']`)
  - `src/domain/cell/drain-policy.ts` (pure: what to do with the current station given a drain and a force flag)
  - `src/adapters/cli/cell.command.ts` (adds `stop`)
  - `test/unit/domain/drain-policy.test.ts`
  - `test/blackbox/cell-stop.test.ts`
- **Dependencies**: `server-drain-endpoint` (routes `POST /api/v1/cells/{id}/drain` and `POST /api/v1/cells/leave`).

---

## 🛠️ Implementation Plan

1. **Supervisor side** `factory cell stop --id <id> [--force]`:
   - `POST /api/v1/cells/{id}/drain`.
   - Prints the Cell's state (`draining`).
   - Does not wait. A later `factory cell list` shows `left` when done.
   - `--force` sends `{ force: true }` in the drain body. The server then signals `['drain', 'force']` (server-drain-endpoint).
2. **Cell side** on heartbeat `signals: ['drain']`:
   - No job held: call `leave` with no `jobId`, then exit `0`.
   - Job held, default: let the station finish. On `done`, `verdict`, `block` or `fail`, the normal transition is sent (cli-08), then `leave`.
   - Job held, `--force`: abort the runner (SIGTERM, then SIGKILL after 5 s), call `leave` with the current `jobId` and `epoch`.
3. **Drain policy** (pure, `drain-policy.ts`): given `{ jobHeld, force, stationFinished }`, returns one of `leave_now`, `wait_for_station`, `abort_then_leave`.
4. **Exit**: the Cell process exits `0` after `leave` returns `200`. A `409 stale_epoch` on leave means the server already moved the Job; the Cell exits `0` and logs it.

---

## ✅ Acceptance Criteria

- [ ] `cell stop --id` sends one drain request and no other request.
- [ ] A Cell with no Job calls `leave` without `jobId` and exits `0`.
- [ ] A Cell with a Job, default mode, sends `leave` only after the station's transition.
- [ ] `--force` aborts the runner and then calls `leave` with the current `jobId` and `epoch`.
- [ ] Drain policy table covered by unit tests (all combinations of the three inputs).
- [ ] `server stop` still sends no cell route (test from cli-04 still passes).
- [ ] No barrel file; no `any`.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md): a fake-server run of stop in both modes.
