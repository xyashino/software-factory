---
status: queued
priority: medium
line: standard
type: feat
depends_on: cell-scale-command
---

# factory-workspace-watch: Factory notices a deleted worktree

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

The Factory daemon checks, on every tick, that each working Cell's worktree still exists. If the user deleted it, the daemon kills that Cell (confirmed exit), reports `worktree_missing` to HQ for the job so the order restarts from scratch, and the Cell's log stays readable.

## Current state (verified)

- Worktree path rule (`apps/sf/src/application/procedures/cell/run-job.procedure.ts:147`): `joinPath(repoRoot, WORKTREES_DIR, slugOf(job.orderId))`, `WORKTREES_DIR = '.worktrees'` (`apps/sf/src/config.ts:41`), `slugOf` in `apps/sf/src/domain/git/branch-names.ts:10`. The Cell, not the daemon, derives it today.
- The Cell's own heartbeat loop (`apps/sf/src/cell/heartbeat.ts`, started at `run-job.procedure.ts:649` and `:1171`) runs inside the Cell process, beats HQ every 10 s and aborts after 4 failed beats. Nothing checks the worktree during a run.
- HQ handles `worktree_missing` in `apps/hq/src/application/procedures/jobs/transition-job.procedure.ts:911-956` (`planWorktreeMissing`, cap `MAX_WORKTREE_RESETS = 2`, resets the order to step 0 with a fresh workspace). Request body (`packages/hq-contracts/src/jobs.contract.ts`): common command fields plus `action: 'worktree_missing'`, `missingStepId`, `missingFiles[]`.
- Cell logs are written by the local slot or daemon outside the worktree (`$XDG_DATA_HOME/sf/cells/<id>.log`; the Cell writes its own log lines through `runtime.logPath`).
- `GitPort.worktreeRemove` exists but no procedure in `apps/sf` calls it: finished or cancelled orders leave their worktree behind today.
- After `cell-scale-command` the daemon knows each Cell's repo path and, from activity reports, its current `orderId`, `stationId` and state. After `factory-relay` it holds each Cell's HQ session and sees the claimed job (`jobId`, `epoch`, `stepId`).

## Target behavior

- Every `HEARTBEAT_INTERVAL_MS` (10 s) the daemon checks, for each Cell in state `running` with a known `orderId`, that the worktree directory exists. Extract the path derivation into one shared helper used by both the Cell and the daemon.
- Missing: (1) kill the Cell and wait for exit; (2) send `worktree_missing` to HQ as that Cell, using the Cell's HQ session held by the relay, with the job's `jobId`, current `epoch`, `missingStepId = job.stepId`, `missingFiles = ['.worktrees/<slug>']`, and a stable `commandId`; (3) call `gone` for the Cell (`cell-gone-transaction`). Because step 2 already ended the job, `gone` finds no active job. This counts toward `MAX_WORKTREE_RESETS` (it is a real missing worktree).
- HQ unreachable at step 2: skip the transition; the lease reaper requeues the job and the next Cell finds no worktree (decision table in `cell-resume-check`).
- The check never touches an idle Cell.
- Logs: the daemon never deletes a Cell's log file when it kills the Cell. Add one line to the log on kill: `worktree deleted, cell stopped`.

## Scope

- **Target**: `apps/sf` (daemon tick, shared path helper)
- **Classification**: `Reliability`
- **Out of scope**: a filesystem watcher (inotify), restoring a deleted worktree, cleaning worktrees of delivered or cancelled orders (not implemented anywhere today; separate todo if wanted), log rotation.

## Verify first

- That the relay exposes the job and the Cell's HQ session to the daemon in a testable way (`factory-relay`).
- The exact required fields of `commandSchema` (`jobs.contract.ts`) and how the Cell builds a `commandId` (`apps/sf/src/domain/cell/command-id.ts`) so the daemon reuses it.
- Whether killing while a Cell is mid-transition can produce a double `worktree_missing`; the command id must make it idempotent.

## Open decisions

- None. Default: check by existence only (the directory), not by content.

## Implementation plan

1. Shared worktree path helper; Cell uses it.
2. Daemon tick: check, kill, report, gone, log line.
3. Tests (black box with fake clock, fs and HQ): deleting the worktree mid-job stops the Cell within one tick and HQ receives exactly one `worktree_missing` with the right ids; an idle Cell is untouched; HQ down skips the report and still kills; the log file still exists afterwards.

## Acceptance criteria

- [ ] Delete a worktree mid-job: the Cell is dead within one tick and the order is reset to step 0 in HQ.
- [ ] Exactly one `worktree_missing` per incident, even if the tick fires twice.
- [ ] The Cell's log is still readable and mentions the kill.
- [ ] Idle Cells are never checked.
- [ ] Tests as described, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
