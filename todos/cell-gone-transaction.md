---
status: queued
priority: high
line: feature
type: feat
depends_on: factory-relay
---

# cell-gone-transaction: a gone Cell never leaves a locked order or a row

## Background (read first; every todo in this series repeats it)

This todo is one step of a redesign of how the software factory runs work. You do not have the design discussion, so this section is the contract. Longer version: `docs/hq-factory-cell-plan.md` (may be missing from your checkout).

### Names: target vs code today

| Target name | Meaning | Name in code today |
| --- | --- | --- |
| HQ | External server: state, queue, projects, work orders, jobs, leases | "Factory": `apps/factory`, package `@repo/factory`, contracts `@repo/factory-contracts` |
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
- `apps/factory` (HQ): Hono routes in `adapters/hono/routes`, procedures in `application/procedures`, drizzle schema in `db/schema`, migrations in `db/migrations`, SQLite via `@repo/bun-sqlite-kit` (`immediateTx` = `BEGIN IMMEDIATE`).
- Wire contracts (zod): `packages/factory-contracts`, `packages/cell-contracts`.
- Constants: `apps/sf/src/config.ts` and `apps/factory/src/config.ts` (`CLAIM_WAIT_MS` 25 s, `HEARTBEAT_INTERVAL_MS` 10 s, `LEASE_TTL_MS` 60 s, `SELF_FENCE_MS` 45 s, `MAX_WORKTREE_RESETS` 2).
- A Cell works in `<repo>/.worktrees/<orderSlug>` (one worktree per order, branch `factory/<slug>`, created with `git worktree add`). Per-step files live in `<worktree>/.cell/` and are git-excluded: `.cell/worktree.json`, `.cell/task.md`, `.cell/<stationId>/state.json`, `prompt`, feedback, logs.

### Repo rules you must follow

- Tests: black box through the public interface, Arrange/Act/Assert, short story-style names ("cancelled order stops its Cell"), no Gherkin, no implementation details, no internals. HTTP backends mocked with `msw` in frontend tests.
- Code: smallest change, follow the code around it, minimal code, comments only for a non-obvious why, no commented-out code, inline exports, order in a file: constants, types, private helpers, exported functions. No barrel files. Strict TypeScript, avoid `unknown` and `as`.
- Markdown: terse (caveman style).
- Git: commit subject `type(scope): title`, scope required. Never commit logs, screenshots, recordings or build output.
- Every change adds exactly one ADR file in `decisions/` (see existing files for the frontmatter: scope, summary, why, date, tags).
- Stop and report if you see personal or sensitive data.

## Objective

When a Cell is gone (stopped, crashed, or its Factory lost HQ) HQ deletes it and cleans every order state it touched, in one transaction. The Factory side kills the process and confirms exit first. After this, a gone Cell leaves no row, no token and no locked order.

## Current state (verified)

- `reapExpiredLeases` (`apps/factory/src/application/procedures/cells/reap-expired-leases.ts`) runs in claim and heartbeat transactions. It sends every job in status `claimed` or `running` whose `leaseExpiresAt <= now` through `loseJob`, then marks silent Cells `offline` (`lastHeartbeatAt + LEASE_TTL_MS <= now`, status in online, busy, draining). Nothing is deleted.
- `loseJob` (`apps/factory/src/application/orders/job-loss.ts`): sets the job `lost` with `finishedAt`; if `order.activeJobId === job.jobId` sets the order `queued`, clears `activeJobId` and `activeCellId` and does `epoch + 1`, and logs the transition; re-queues a plan branch job; releases the Cell (`activeJobId` null, status `busy` to `online`). It does NOT clear `work_orders.pinned_cell_id`.
- Claim treats an order pinned to another Cell as not claimable unless that Cell is unreachable (`pinnedCellUnavailable` from `isUnreachable(status)`, `claim-job.procedure.ts:159-162`; rule in `apps/factory/src/domain/cells`). Pin is set at claim time (`:317`).
- Foreign keys to `cells.cell_id`: `jobs.cell_id` (`db/schema/jobs.ts:83`), `work_orders.pinned_cell_id` (`db/schema/orders.ts:78`), `tokens.cell_id` (`db/schema/tokens.ts:26`). `work_orders.active_cell_id` has no FK.
- `lastHeartbeatAt` is set only by `hello` and `heartbeat` (`hello-cell.procedure.ts:98`, `heartbeat-cell.procedure.ts:86`). An idle Cell in the claim long-poll is not refreshed, so deleting "silent" Cells by this field would delete idle Cells.
- The Factory daemon (`factory-daemon-sf`) can kill a Cell and confirm exit; it knows its Cells (`factory-relay`). HQ knows each Cell's owning Factory (`cells.factory_id`) and each Factory's `lastSeenAt` (`factory-hq-link`).
- `MAX_WORKTREE_RESETS = 2` counts `worktree_missing` reports only (`transition-job.procedure.ts`); keep it that way.

## Target behavior

HQ procedure `goneCell(tx, cellId)` (shared by all callers), idempotent:

1. If the Cell has a `claimed` or `running` job: `loseJob` it (job `lost`, order `queued`, active fields cleared, `epoch + 1`).
2. Clear `work_orders.pinned_cell_id` where it equals this Cell.
3. Delete the Cell's tokens, then the Cell row.
4. Job history keeps the old Cell id: relax `jobs.cell_id` to plain text with no foreign key; `work_orders.pinned_cell_id` becomes `ON DELETE SET NULL` or is cleared in step 2 (pick one and migrate); tokens cascade.

Callers:

- `POST /api/v1/factories/cells/:cellId/gone` (scope `factory:worker`, only for Cells owned by the calling Factory): the Factory calls it after it killed the process and confirmed exit. Unknown or already deleted Cell: respond 200 (idempotent).
- The reaper: a Cell whose lease and last activity are older than `LEASE_TTL_MS` is deleted via `goneCell`; a Factory with `lastSeenAt + LEASE_TTL_MS <= now` has all its Cells deleted via `goneCell`.
- To keep idle Cells alive, refresh `lastHeartbeatAt` (or a new `lastSeenAt`) on every claim request, including the long-poll start.

Factory order, always: kill process, confirm exit, then call `gone`. If HQ is unreachable at that time, the 60 s reaper does it later. A late result from the killed process is rejected by the `epoch` fence (existing behavior; add a test).

A Cell deletion never increments `worktreeResets`.

## Scope

- **Target**: `apps/factory` (procedure, route, reaper, migration), `packages/factory-contracts`, `apps/sf` (daemon calls `gone` after kill)
- **Classification**: `Domain logic`
- **Out of scope**: dropping the `cells` table and random ids (`cell-identity-slim`), removing drain/leave (`cell-drain-removal`), scale command.

## Verify first

- Whether SQLite needs a table rebuild to drop or change the three foreign keys; plan the migration (see how `0001_cell_drain_leave.sql` and `db/migrations/index.ts` were written; `db:check` runs in `ci:verify`).
- Every place that selects from `cells` assuming the row exists after a job (`job-loss.ts` `releaseCell`, transitions, `list-cells`, web UI): all must tolerate a missing row.
- That the reaper's call sites hold a write transaction (`immediateTx`) so the delete is atomic with `loseJob`.
- Whether the web UI (`apps/web-demo`) lists Cells and needs `offline` or `left` states removed (leave it unless it breaks).

## Open decisions

- `pinned_cell_id`: clear in code (default) vs `ON DELETE SET NULL`.

## Implementation plan

1. Migration for the FK changes.
2. `goneCell`, the route, reaper changes, claim refreshes activity.
3. Daemon: after confirmed kill, call `gone`; on HQ failure rely on the reaper.
4. Tests (`apps/factory/test/blackbox`, `apps/sf/test/blackbox`): gone Cell mid-job leaves the order `queued`, claimable by another Cell, `epoch` bumped, Cell row and tokens gone, job history keeps the Cell id; calling `gone` twice is safe; a result from the old `epoch` is rejected; silent Factory deletes all its Cells at the lease expiry; an idle Cell in a long-poll is not deleted; `worktreeResets` unchanged.

## Acceptance criteria

- [ ] After `gone` the order is `queued` with no active or pinned Cell and a higher `epoch`.
- [ ] No Cell row or token remains; old jobs still show their Cell id.
- [ ] `gone` is idempotent.
- [ ] A late completion with the old `epoch` is rejected.
- [ ] A silent Factory's Cells are deleted at the 60 s lease expiry; idle Cells of a live Factory are not.
- [ ] Tests as described, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
