---
status: queued
priority: medium
line: feature
type: feat
depends_on: cell-gone-transaction
---

# cell-scale-command: sf cell scale N inside a repo

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

`sf cell scale N`, run inside a repo with `.factory/config.json`, sets the desired number of Cells for that repo's project on this PC. The Factory daemon starts or kills Cells to match. This replaces `sf cell create|stop|rm`. The count lives in memory only.

## Current state (verified)

- `sf cell create [--count N] [--name slug] [--lines a,b] [--repo path] [--project id] [--json]` (`apps/sf/src/adapters/cli/cell.command.ts` around lines 330-376; `application/procedures/cell/local-create.procedure.ts`). `--project` is documented as "required outside a repo with .factory/config.json".
- `resolveCellTarget` (`application/procedures/cell/resolve-project-target.ts`): project id is the explicit `--project`, else `project` from `<repoRoot>/.factory/config.json` (`readProjectId`), else an interactive chooser over the HQ project list. A project unknown to HQ is refused with `project X is not registered on this Factory` and `fix: sf project add X --repo <url>` (the word "Factory" there means HQ).
- Outside a repo, `ensureWorkspace` (`application/procedures/cell/workspace.ts`) clones the project into `WORKSPACES_DIR/<projectId>` and runs the Cell there. This violates hard rule 4 and must go.
- HQ already has a per-project cap on concurrently running orders: `project.maxRunning`, enforced in claim selection (`runningCount`, `maxRunning` in `claim-job.procedure.ts`). It is independent of Cell count and stays.
- After `factory-daemon-sf` and `factory-relay`: the daemon spawns, tracks and kills Cells and relays their traffic; after `cell-gone-transaction` a killed Cell is reported gone to HQ.
- Cells report nothing about what they are doing to the daemon yet.

## Target behavior

CLI:
- `sf cell scale <N>`, N an integer >= 0. `repoRoot` = nearest ancestor of the cwd that contains `.factory/config.json`. None found: refuse with `not inside a repo with .factory/config.json`. No `--project` flag. `--lines a,b` stays (limits which Lines these Cells take).
- The project id is read from that config. If HQ does not know it: refuse and print `sf project add <id> --repo <url>`. Check through the existing project list call (operator connection).
- One repo path per project per Factory: if the daemon already has Cells for this project from another `repoRoot`, refuse and print the registered path.
- Remove `sf cell create`, `stop`, `rm` and the outside-a-repo clone path (`ensureWorkspace`, `WORKSPACES_DIR` use for Cells). Keep `sf cell list` (shows per project: repo path, desired, running, each Cell id and state) and the internal `sf cell start` (the worker entry the daemon spawns). Removed commands exit non-zero with `use "sf cell scale N"`.

Daemon:
- Loopback API `PUT /scale { repoRoot, projectId, lines?, count }`. State in memory: map projectId to `{ repoRoot, desired }`.
- Reconcile: running < desired spawns Cells; running > desired kills Cells in the scale-down order below, each via the confirmed-exit path and the `gone` call.
- A Cell that exits on its own is respawned to meet `desired`, with backoff 1 s, 2 s, 4 s ... capped at 30 s; after 5 exits within 60 s respawning stops for that project and `sf cell list` shows `crash loop`.
- Reboot, daemon restart, or HQ loss resets everything to 0 (hard rule 8). Not connected to HQ: refuse to scale up.
- Activity reports: a Cell tells the daemon over loopback `POST /cells/:cellId/activity { state: 'idle' | 'running', orderId?, stationId?, writes?, since }` when it starts or finishes a claim wait or a station. `writes` is true for the committing (builder) station (see `checkpoint-builder-only`), false for read-only operators and inspections.

Scale-down order: (1) idle Cells; (2) running Cells whose station has `writes: false`, newest `since` first; (3) running Cells in a writing station, newest `since` first (least work lost). The killed Cell's job goes back to the queue and the next Cell resumes from the worktree (`cell-resume-check`).

## Scope

- **Target**: `apps/sf` (cell command, daemon scale and reconcile, activity endpoint, Cell activity reports), remove the outside-repo clone path
- **Classification**: `Integration`
- **Out of scope**: workspace watch (`factory-workspace-watch`), identity changes, persisting the count, a capacity cap.

## Verify first

- Every caller and test of `create`, `stop`, `rm`, `ensureWorkspace` (`git grep -n "ensureWorkspace\|WORKSPACES_DIR\|local-create\|local-stop\|local-rm" -- apps docs`).
- Where in `run-job.procedure.ts` a claim wait starts and ends and where a station starts and ends, to place the activity reports.
- `sf setup` and `sf service` (`adapters/cli/setup.command.ts`, `service.command.ts`): do they call `cell create`? Update them to `scale`.
- How `readProjectId` fails on a malformed config, and reuse that error.

## Open decisions

- Removed commands: hard error (default) vs deprecated aliases that translate to `scale`. Default: hard error with a pointer, since their semantics (named slots) differ.

## Implementation plan

1. Remove outside-repo clone and the three commands; add `scale` and the new `list`.
2. Daemon: scale state, reconcile loop with backoff, activity endpoint, scale-down order.
3. Cell: activity reports.
4. Tests (black box, fake process and clock ports): `scale 2` then `scale 0` leaves no process; scale-down order idle, then read-only, then newest builder; outside a repo refuses; unknown project refuses with the `project add` hint; second repo path for the same project refuses naming the first; a crashing Cell is respawned with backoff and stops after 5 exits in 60 s; restart of the daemon resets to 0.

## Acceptance criteria

- [ ] `sf cell scale N` works only inside a repo with `.factory/config.json` and takes no project flag.
- [ ] Scale up and down converge to N; killed Cells go through confirmed exit and `gone`.
- [ ] Scale-down kills idle first, then read-only stations, then the newest builder.
- [ ] One repo path per project per Factory is enforced with a clear message.
- [ ] No code path clones a repo outside the user's checkout.
- [ ] Tests as described, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
