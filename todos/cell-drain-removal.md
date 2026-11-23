---
status: queued
priority: low
line: standard
type: refactor
depends_on: cell-identity-slim
---

# cell-drain-removal: delete drain, force, leave and handover

## Background (read first; every todo in this series repeats it)

This todo is one step of a redesign of how the software factory runs work. You do not have the design discussion, so this section is the contract. Longer version: `docs/hq-factory-cell-plan.md` (may be missing from your checkout).

### Names: target vs code today

| Target name | Meaning | Name in code today |
| --- | --- | --- |
| HQ | External server: state, queue, projects, work orders, jobs, leases | "HQ": `apps/hq`, package `@repo/hq`, contracts `@repo/factory-contracts` |
| Factory | Local daemon, one per PC. Only holder of the HQ credential. Spawns, supervises and kills Cells | Does not exist. Closest: cell-server `apps/cell` (`@repo/cell`, port 7071, own SQLite) and local slots (`slots.json`) |
| Cell | Disposable worker: one process, one job at a time, runs inside a repo | Cell daemon: `sf cell start`, code in `apps/sf/src/application/procedures/cell/*` |
| Line | Pipeline template `.factory/lines/<name>.yml` (stations in order) | same |
| Station | One step of a Line (operator, inspection, deliver) | same |
| Job | One execution attempt of one station, claimed by a Cell | same |
| Project | A repo containing `.factory/config.json` (field `project`) | same |

Do not rename code unless this todo says so. In code keep today's names. In docs and new comments use target names.

### Target architecture

```
sf / web (operator) --> HQ <-- Factory (local PC) <-- Cells (loopback only)
```

- Every connection is outbound from the local PC. No open port except loopback.
- HQ never talks to a Cell. A Cell talks only to its Factory on `127.0.0.1`.
- Operator token (sf, web) and machine credential (Factory) are different credentials.

### Hard rules (decided, do not reopen)

1. Only the builder station edits code. No commit per step. The builder commits once per build attempt (`build.commit`). Other stations never commit.
2. Cell id is random per run, not stored in HQ, has no token and no status. A gone Cell leaves no row.
3. Stop means delete. No drain, no handover, no `deleted` or `revoked` status.
4. A Cell starts only inside a repo with `.factory/config.json`. The project comes from that file. No project flag. One repo path per project per Factory.
5. Kill first, requeue second. The Cell process must be confirmed dead before HQ requeues its job, otherwise two processes share one worktree. The job `epoch` fences late results.
6. The Factory kills all Cells after 45 s without HQ. HQ reaps a silent lease after 60 s (`LEASE_TTL_MS`). The kill must always come first.
7. Resume only on the same PC and repo. If anything needed is missing, delete the worktree and start the order from scratch.
8. The Factory keeps no state except its HQ credential. The Cell count lives in memory only.
9. Never print or log tokens.

### Repo orientation

- Bun + turbo monorepo. Package manager is bun (the root `CLAUDE.md` still says pnpm; it is generated and stale). Verify with `bun run ci:verify`.
- `apps/sf`: CLI and Cell daemon. Hexagonal: `application/procedures/*` use ports from `application/ports/*`; adapters in `adapters/{cli,fs,git,http,process,runners}`; domain in `domain/*`; tests in `test/{unit,blackbox}`.
- `apps/hq` (HQ): Hono routes in `adapters/hono/routes`, procedures in `application/procedures`, drizzle schema in `db/schema`, migrations in `db/migrations`, SQLite via `@repo/bun-sqlite-kit` (`immediateTx` = `BEGIN IMMEDIATE`).
- Wire contracts (zod): `packages/factory-contracts`, `packages/cell-contracts`.
- Constants: `apps/sf/src/config.ts` and `apps/hq/src/config.ts` (`CLAIM_WAIT_MS` 25 s, `HEARTBEAT_INTERVAL_MS` 10 s, `LEASE_TTL_MS` 60 s, `SELF_FENCE_MS` 45 s, `MAX_WORKTREE_RESETS` 2).
- A Cell works in `<repo>/.worktrees/<orderSlug>` (one worktree per order, branch `factory/<slug>`, created with `git worktree add`). Per-step files live in `<worktree>/.cell/` and are git-excluded: `.cell/worktree.json`, `.cell/task.md`, `.cell/<stationId>/state.json`, `prompt`, feedback, logs.

### Repo rules you must follow

- Tests: black box through the public interface, Arrange/Act/Assert, short story-style names ("cancelled order stops its Cell"), no Gherkin, no implementation details, no internals. HTTP backends mocked with `msw` in frontend tests.
- Code: smallest change, follow the code around it, minimal code, comments only for a non-obvious why, no commented-out code, inline exports, order in a file: constants, types, private helpers, exported functions. No barrel files. Strict TypeScript, avoid `unknown` and `as`.
- Markdown: terse (caveman style).
- Git: commit subject `type(scope): title`, scope required. Never commit logs, screenshots, recordings or build output.
- Every change adds exactly one ADR file in `decisions/` (see existing files for the frontmatter: scope, summary, why, date, tags).
- Stop and report if you see personal or sensitive data.

## Objective

Stop means gone. Remove the drain and force signals, the draining and left states, `leaveCell` and the job handover path, in HQ, sf, contracts, tests and docs. After `cell-identity-slim` HQ no longer has Cell rows, so this is mostly deletion.

## Current state (verified)

- HQ: `apps/hq/src/application/procedures/cells/drain.procedure.ts`, `leave.procedure.ts`; routes `POST /api/v1/cells/leave` and `POST /api/v1/cells/:id/drain` (`adapters/hono/routes/cells.route.ts`); drain-related code in `claim-job.procedure.ts`, `heartbeat-cell.procedure.ts` (`drainSignals`), `hello-cell.procedure.ts` (revives status `left`), `reap-expired-leases.ts` (`draining` in the silent statuses), `transition-job.procedure.ts`; schema column `cells.drain_force` and statuses `draining`, `left`; migration `db/migrations/0001_cell_drain_leave.sql`.
- Contracts (`packages/factory-contracts/src/cells.contract.ts`): `drainCellContract`, `leaveCellContract`, claim reply `signals: ['drain']`, heartbeat reply `signals: ['abort','drain','force']`.
- sf: `apps/sf/src/cell/drain-signal.ts`, `apps/sf/src/domain/cell/drain-policy.ts`, `application/procedures/cell/leave.procedure.ts` (hands a job over with `workspaceMode: 'reuse'`, `:132` on the HQ side), `stop.procedure.ts`, `claim-loop.procedure.ts` (`observeDrain`, `leaveCell`), `cell-runtime.ts` (`drain` state), `run-job.procedure.ts`, `start.procedure.ts`, `adapters/cli/cell.command.ts` (`--force`).
- Tests that cover it: `apps/hq/test/blackbox/cells-drain-leave.test.ts`, `route-index.test.ts`; `apps/sf/test/blackbox/cell-lifecycle.test.ts`, `cell-stop.test.ts`; `apps/sf/test/unit/cell/drain-signal.test.ts`, `unit/domain/drain-policy.test.ts`, `unit/contracts/cells.contract.test.ts`, `unit/application/run-job-log.test.ts`, `run-mechanic-job.test.ts`.
- Docs: `docs/cell.md`, `docs/sf.md`, `docs/cell-runner-plan.md`, `docs/plans/contracts-plan.md`.
- History: drain and force were added and fixed on 2026-11-20 and 2026-11-21 (ADRs `20261120-*`, `20261121-175500-factory-fix-cell-drain-force-offline.md`). Removing them is intentional and reverses those ADRs.
- After the earlier todos, stopping a Cell is: kill the process, confirm exit, report gone (`cell-scale-command`, `cell-gone-transaction`).

## Target behavior

- No `drain`, `force` or `leave` symbol remains in code, contracts, routes, schema or tests. Existing ADRs are not edited.
- Claim reply has no `signals`. Heartbeat reply `signals` is `['abort']` only.
- The Cell loop has two exits: `abort` from heartbeat and process termination. `observeDrain`, the draining state and the superseded handling for drain go away; keep `superseded` only if something other than drain uses it (verify).
- Migration: drop `cells.drain_force`, statuses `draining` and `left` (if the `cells` table is already gone after `cell-identity-slim`, there is nothing left to migrate; remove the migration-only leftovers).
- Docs describe stop as "process is killed, job is requeued, next Cell resumes from the worktree".

## Scope

- **Target**: `apps/hq`, `apps/sf`, `packages/factory-contracts`, docs
- **Classification**: `Cleanup`
- **Out of scope**: new behavior; the kill and gone paths (already built).

## Verify first

- Run `git grep -n -i "drain\|leaveCell\|'left'\|force" -- apps packages docs ':!decisions'` and list every hit; separate real drain uses from unrelated `force` (for example `git push --force` or CLI flags unrelated to Cells).
- Whether `superseded` (`StartOutcome` in `start.procedure.ts`) has another producer.
- That no web UI element sends drain (`apps/web-demo`).

## Open decisions

- None.

## Implementation plan

1. Remove HQ routes, procedures, contracts, schema bits and tests.
2. Remove sf drain state, signals, `leaveCell`, `--force`, and simplify the claim loop and heartbeat.
3. Fix docs; delete or rewrite tests that only existed for drain.
4. Add one black-box test per remaining exit: abort ends a running job; killing the process requeues it (covered by earlier todos, only add what is missing).

## Acceptance criteria

- [ ] `git grep -n -i "drain\|leaveCell" -- apps packages docs ':!decisions'` finds nothing.
- [ ] Heartbeat replies carry only `abort`; claim replies carry no signals.
- [ ] No route `/leave` or `/:id/drain`.
- [ ] Remaining tests pass and no test depends on drain.
- [ ] One new ADR in `decisions/` that supersedes the drain and force ADRs.
- [ ] `bun run ci:verify` passes.
