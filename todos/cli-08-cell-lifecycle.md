---
status: todo
factory: v2
plan: factory-cli
depends_on: [cli-07-operator-verbs]
priority: high
line: feature
type: feat
---

# Todo: `cli-08-cell-lifecycle` — `factory cell start`, `list`, `revoke`

## 🎯 Objective

Run the Cell loop from `apps/factory-server/docs/PLAN.md` §3 with a fake runner: enroll, hello, claim, check, start the Job, heartbeat, finish or hand over. Runners are added in cli-09.

---

## 🌐 Context & Problem Statement

- The Cell is the only process that talks to the server for work. It owns the loop, the worktree checks and the operator endpoint (`apps/factory/docs/PLAN.md` §3).
- The server defines each step: `enroll`, `hello`, `claims` (long-poll, `waitMs: 25000`), `heartbeats` (every 10 s), `jobs/{id}/transitions`. The CLI must send exactly those, with the same `commandId` on retry.
- A Cell that loses the server must not drop its work silently. After 45 s without a heartbeat it aborts its runner, and the lease ends at 60 s (factory-server PLAN §3.7).
- `cell stop` is not part of this step. It needs the server drain endpoint (server-drain-endpoint, cli-11).

---

## 📦 Specification / Scope

- **Target**: `apps/factory/src/application/procedures/cell/`, `apps/factory/src/cell/`, `apps/factory/src/adapters/cli/cell.command.ts`, `apps/factory/src/adapters/fs/cell-state.ts`.
- **Classification**: `Integration` and `Domain Core` (loop policy).
- **Files to create**:
  - `src/domain/cell/cell-loop.ts` (pure policy: next action given the last reply, the time and the heartbeat count; no I/O, no clock)
  - `src/domain/cell/command-id.ts` (`commandId = sha256(cellId + orderId + epoch + command)`, the formula in factory-server PLAN §3.7)
  - `src/application/procedures/cell/enroll.procedure.ts`
  - `src/application/procedures/cell/hello.procedure.ts`
  - `src/application/procedures/cell/claim-loop.procedure.ts`
  - `src/application/procedures/cell/run-job.procedure.ts`
  - `src/application/procedures/cell/list.procedure.ts`
  - `src/application/procedures/cell/revoke.procedure.ts`
  - `src/adapters/fs/cell-state.ts` (`.factory-local/cell.json`, mode `0600`)
  - `src/adapters/cli/cell.command.ts`
  - `src/cell/heartbeat.ts` (interval, failure counter, self-fence)
  - `test/unit/domain/cell-loop.test.ts`, `command-id.test.ts`
  - `test/blackbox/cell-lifecycle.test.ts`
- **Dependencies**: none added.

---

## 🛠️ Implementation Plan

1. **`cell start`**:
   - Reads `.factory/config.json` (`project`) and `.factory/lines/*.yml` (names for `allowedLines`).
   - If `.factory-local/cell.json` has no token, reads `FACTORY_JOIN_TOKEN` and calls `POST /api/v1/cells/enroll`. Stores the returned `sf_cell_` token. The join token is never stored.
   - Calls `POST /api/v1/cells/hello` with `projectId`, `allowedLines`, `runners` (from the registry, cli-09), `localWorktrees`. If the reply has `resumedJob`, the loop starts with it.
2. **Claim loop**: `POST /api/v1/cells/claims` with `waitMs: 25000`. Empty reply: loop. Job reply: continue to step 3.
3. **Line check**: if `.factory/lines/<line>.yml` is missing or invalid, send `transitions { action: line_unavailable, lineName, detail, epoch }`. The reply may carry `nextJob`; use it if present.
4. **Worktree check**: for `stepIndex > 0`, check `<repo>/.worktrees/<slug>/.cell/worktree.json` and each prior `.cell/<step-id>/state.json`. Missing: send `worktree_missing`, then start from step 0 with `workspaceMode: fresh`.
5. **Start**: send `transitions { action: start, epoch, lineSnapshot }`. The lineSnapshot is built by `domain/line` from the YAML (stations, kinds, required files, max attempts).
6. **Run**: call the runner port (fake in this step) and open the operator endpoint (cli-07 client's counterpart, defined in `application/ports/operator-endpoint.port.ts`). Set `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN` for the runner.
7. **Heartbeat**: every 10 s, `POST /api/v1/cells/heartbeats`. Read `signals`. `abort` stops the runner. Four consecutive failures (45 s) abort the runner locally.
8. **Finish**: when the operator endpoint receives `done`, `verdict` or `block`, the Cell checks local facts (required files exist) and sends the matching transition. The reply's `nextJob` is taken inline, with no new claim.
9. **Command ids**: every mutating call sends `commandId` from `command-id.ts`. A retry after a network error reuses the same id.
10. **`cell list`**: `GET /api/v1/cells`. Table: id, project, state, pinned order, last heartbeat.
11. **`cell revoke --id`**: `DELETE /api/v1/cells/{id}`. Requires `--yes`. Exit `2` without it.

---

## ✅ Acceptance Criteria

- [ ] `cell start` with no stored token calls `enroll` once and stores the token with mode `0600`.
- [ ] The join token is never written to disk (test with a fake fs).
- [ ] `hello` carries `projectId` from `.factory/config.json`, not from a flag.
- [ ] A claim reply of empty triggers another claim with `waitMs: 25000`.
- [ ] A missing line sends `line_unavailable` and no `start`.
- [ ] A missing prior step file sends `worktree_missing` and then a step 0 job.
- [ ] Four consecutive heartbeat failures abort the runner (time is injected through the clock port).
- [ ] A retried transition sends the same `commandId` as the first attempt.
- [ ] `cell revoke` without `--yes` exits `2` and sends nothing.
- [ ] `cell start` never calls a drain route (no drain in this step).
- [ ] No barrel file; no `any`.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md): a fake-server run covering enroll, hello, claim, start, complete.
