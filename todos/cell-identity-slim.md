---
status: queued
priority: medium
line: feature
type: refactor
depends_on: cell-gone-transaction
---

# cell-identity-slim: a Cell is a random, unstored worker; HQ knows only Factories

## Background (read first; every todo in this series repeats it)

This todo is one step of a redesign of how the software factory runs work. You do not have the design discussion, so this section is the contract. Longer version: `docs/hq-factory-cell-plan.md` (may be missing from your checkout).

### Names: target vs code today

| Target name | Meaning | Name in code today |
| --- | --- | --- |
| HQ | External server: state, queue, projects, work orders, jobs, leases | "HQ": `apps/hq`, package `@repo/hq`, contracts `@repo/hq-contracts` |
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
- Wire contracts (zod): `packages/hq-contracts`, `packages/cell-contracts`.
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

HQ stops storing Cells. A Cell is identified by a random id the Factory picks per run, sent with each request. Orders pin to a Factory, not a Cell. There is no `cells` table, no Cell token and no Cell status in HQ. Cell routes are authenticated by the Factory credential. This is the largest todo of the series: if it grows past one reviewable change, split it along the steps in the plan and keep each step green.

## Current state (verified)

- Table `cells` (`apps/hq/src/db/schema/cells.ts`): `cellId` (PK, `projectId` + name via `scopedId`), `name`, `projectId` (FK), `allowedLinesJson`, `status` (`online|busy|draining|left|offline|revoked`), `runnersJson`, `localWorktreesJson`, `activeJobId`, `drainForce`, `lastHeartbeatAt`, `createdAt`, `revokedAt`.
- Files that read or write it (`apps/hq/src`): `application/orders/job-loss.ts`, `application/orders/order-writes.ts`, `application/procedures/cells/{claim-job,drain,enroll-cell,heartbeat-cell,hello-cell,leave,list-cells,reap-expired-leases,revoke-cell}.procedure.ts`, `application/procedures/jobs/transition-job.procedure.ts`, `db/client.ts`, schema files `jobs.ts`, `orders.ts`, `tokens.ts`.
- Foreign keys to `cells.cell_id`: `jobs.cell_id`, `work_orders.pinned_cell_id`, `tokens.cell_id`. After `cell-gone-transaction`, `jobs.cell_id` is plain text and `pinned_cell_id` is cleared on delete.
- Claim (`claim-job.procedure.ts`) loads the Cell row for `projectId`, `allowedLines`, `localWorktrees` and builds `ClaimCell`; `selectClaimable` (in `apps/hq/src/domain/cells/`) rejects an order pinned to another Cell that is still reachable (`pinnedCellId`, `pinnedCellUnavailable`) and prefers warm orders (`localWorktrees`). The pin is written at claim time (`:317`). The Cell always sends `localWorktrees: []` in hello today, so the warm preference is effectively unused.
- Auth: token kinds `cell_join` and `cell_session` with scopes `cell:enroll` and `cell:worker`; `ctx.principal.cellId` is the Cell identity in claim, heartbeat, hello, transitions.
- HQ routes: `apps/hq/src/adapters/hono/routes/cells.route.ts`: `/enroll`, `/hello`, `/claims`, `/heartbeats`, `/leave`, `/:id/drain`, `GET /`. `hello` returns `resumedJob` for a re-connecting Cell (`resumeActiveJob`).
- `sf cell revoke` removes a Cell on HQ (`application/procedures/cell/revoke.procedure.ts`); `sf cell list` merges HQ Cells with local pids.
- After the earlier todos: the daemon relays all Cell traffic, enrolls Cells itself and tells HQ when a Cell is gone; HQ knows Factories (`factories`, `lastSeenAt`, token kind `factory_session`).

## Target behavior

HQ:
- Cell routes accept the Factory credential (`factory:worker`). The Cell identity is a header `x-cell-id` (random id chosen by the daemon, opaque string) added by the relay. HQ never creates a row for it.
- `POST /api/v1/cells/claims` body gains `projectId`, `allowedLines`, `runners` (sent by the Cell through the relay on every claim); `hello` and `enroll` are removed. `resumedJob` is removed (a new Cell after a restart is simply a new claimer; the job it held was requeued by `gone` or the reaper).
- Jobs record `claimed_by_cell_id` (text, from the header) and `claimed_by_factory_id` (FK to `factories`). `work_orders.pinned_cell_id` becomes `pinned_factory_id` (FK to `factories`); the claim rule becomes: an order pinned to another Factory is claimable only if that Factory is unreachable (`lastSeenAt + LEASE_TTL_MS <= now`). `active_cell_id` stays as informational text.
- Presence of idle Cells is not tracked in HQ. HQ shows per Factory what the daemon reports in its heartbeat: `projects: [{ projectId, desired, running }]` stored on the `factories` row (display only).
- The reaper only deals with jobs (lease expiry) and Factories (silent Factory: requeue all its active jobs via the same loss code as `goneCell`, now keyed by Factory).
- Remove token kinds `cell_join` and `cell_session`, scopes `cell:enroll` and `cell:worker`, `sf cell revoke`, the HQ route `GET /cells` (replace with the per-Factory projects in `GET /factories`), `cells` table and its migration steps.

sf:
- The daemon relay (`factory-relay`) no longer enrolls Cells or swaps per-Cell tokens; it forwards with the Factory credential and adds `x-cell-id`. The Cell sends its attributes in each claim. Remove `enroll.procedure.ts`, `hello.procedure.ts`, `cell-state` session files, and `revoke.procedure.ts`.
- `sf cell list` reads only the local daemon.
- Cell ids are random per run: `cell-<8 hex>`; they are never reused.

## Scope

- **Target**: `apps/hq` (schema, migration, claim, routes, reaper, tokens), `packages/hq-contracts`, `apps/sf` (relay, Cell start, list)
- **Classification**: `Data model`
- **Out of scope**: drain/leave removal (next todo; this todo may leave dead drain code only if the table is already gone, otherwise coordinate), web UI redesign (fix only what breaks).

## Verify first

- Whether SQLite needs a table rebuild to drop or change foreign keys (rebuild the table in the migration if so); read `db/migrations/0001_cell_drain_leave.sql`, `db/migrations/index.ts`, and how `db:check` validates them.
- Existing data: dropping the `cells` table while jobs and orders reference it. Plan the migration order: relax FKs, add new columns and backfill `claimed_by_cell_id` from `cell_id`, then drop `cells`.
- Every `sf` and web call to `/api/v1/cells` (`git grep -n "api/v1/cells" -- apps packages docs`).
- Whether the transition and heartbeat routes need the Cell id (they use `activeJobId` and `epoch`; check what still needs the principal's cell).

## Open decisions

- None. Hard rules 2 and 3 settle the model.

## Implementation plan (each step must keep `ci:verify` green)

1. Add `factories.projects_json`, `jobs.claimed_by_cell_id`, `jobs.claimed_by_factory_id`, `work_orders.pinned_factory_id`; accept `factory:worker` plus `x-cell-id` on Cell routes next to the old auth; claim takes attributes from the body.
2. Switch the relay and the Cell to the new contract; stop using enroll, hello and session files.
3. Switch the pin rule to Factories; port `selectClaimable` tests.
4. Remove `cells` table, token kinds, scopes, routes, `sf cell revoke`, and fix docs (`docs/hq.md`, `docs/cell.md`, `docs/sf.md`).
5. Tests (black box): two Cells of one Factory both claim; an order pinned to a live Factory is not claimable by another Factory; a silent Factory unpins its orders and requeues its jobs; old job history keeps `claimed_by_cell_id`; no route accepts a Cell token; no `cells` table.

## Acceptance criteria

- [ ] HQ has no `cells` table, no Cell token kinds or scopes, and no Cell status.
- [ ] A claim works with only the Factory credential and `x-cell-id`.
- [ ] Orders pin to a Factory; a silent Factory releases them at the lease expiry.
- [ ] Job history still shows which Cell id ran each job.
- [ ] `sf cell revoke` is removed.
- [ ] Tests as described, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
