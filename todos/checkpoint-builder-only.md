---
status: queued
priority: high
line: feature
type: refactor
depends_on: step-files-atomic
---

# checkpoint-builder-only: only the builder station commits and pushes

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

Enforce the hard rule: only the builder edits code and commits, once per build attempt. Every other station finishes without a commit or push and leaves the worktree clean. The git port gains the primitives the resume todo needs.

## Current state (verified)

- `checkpointStation` (`apps/sf/src/application/procedures/cell/checkpoint.procedure.ts:45-70`) runs after a station completes (call site `run-job.procedure.ts:517-525`). Logic: `reported = checkpointPaths(producedFiles)` (`domain/git/checkpoint-policy.ts`; it strips `.cell/` paths). If `reported` is empty and `git status` is clean it returns `undefined`. Otherwise it commits `reported` (or the whole worktree `.` when nothing was reported) with the message from `.cell/<stationId>/commit.txt` or `chore(factory): checkpoint <slug>`, fails if changes are left over, pushes to branch `factory/<slug>`, returns `headSha`.
- The caller uses `checkpoint result ?? git.headSha(worktree)`: HQ requires a `commitSha` on every `complete` (`requireCommitSha`, `apps/hq/src/application/procedures/jobs/transition-job.procedure.ts:196`). HQ stores it as step `resultCommitSha`, job `lastCommitSha` and order `headCommitSha` (`:272`, `:301`, `:612`).
- So today any station that leaves a dirty tree (a read-only operator that wrote a stray file, or an inspection such as `quality-gate` running `ci:verify` that touches files) gets committed and pushed as a checkpoint. A clean read-only station already commits nothing.
- Line files (`.factory/lines/*.yml`): stations have `kind` (operator, inspection, deliver), operators have `permission: read|write` (default write; the planner in `feature.yml` is also `write`), and a `deliver:` block `commit: build.commit`, `report: build.report`, `to: new-pr`. In `apps/sf/src/domain/line/parse-line.ts` the `deliver` block is `z.looseObject({ requireAdr })`, so `commit` is not validated today.
- `GitPort` (`application/ports/git.port.ts`) has `worktreeAdd`, `worktreeRemove`, `commit`, `push`, `headSha`, `status`, `isClean`, `excludeLocally`, `clone`, `originUrl`, `currentBranch`. No `reset`, no `clean`.
- `.cell/` is excluded locally (`CELL_EXCLUDE`), so it never shows in `git status` and is never committed.

## Target behavior

1. Identify the committing station. Default: the station id named by `deliver.commit` (`build.commit` means station `build`). Only that station runs `checkpointStation`.
2. Every other station: skip commit and push. Report the current `headSha` as `commitSha` (HQ still requires one; the value does not change `headCommitSha` because nothing new was committed).
3. After a non-committing station completes, if `git status` shows changes outside `.cell/`: discard them (`git checkout -- .` and `git clean -fd`, never `-x`, so ignored `.cell/` survives) and write one log line `discarded changes from <stationId>: <paths>`. The next station always starts from a clean tree equal to `HEAD`.
4. The committing station still commits only once per attempt, still pushes to `factory/<slug>`. A retry (inspection `onFail.retry: build`) is a new attempt on top of the previous build commit.
5. `GitPort` gains `resetHard(cwd, sha)`, `clean(cwd)` (`-fd`, no `-x`), `discardChanges(cwd)` (checkout plus clean) and `hasCommit(cwd, sha)` (`git cat-file -e <sha>^{commit}`). Implement in `adapters/git/git.ts`. This todo uses `discardChanges`; todo `cell-resume-check` uses the rest.

## Scope

- **Target**: `apps/sf` (checkpoint, run-job, git port and adapter, line parsing if a field is added)
- **Classification**: `Domain logic`
- **Out of scope**: resume logic, HQ changes, the deliver step, PR creation.

## Verify first

- Which code path completes each station kind. Check whether inspection stations (`quality-gate`) and the mechanic/incident jobs also reach the `checkpointStation` call at `run-job.procedure.ts:517-525`.
- Whether `deliver.commit` exists in all three line files (`fast`, `feature`, `standard`) and always points at one station.
- Whether `deliver.procedure.ts` reads files or commits from the worktree in a way that assumes earlier stations committed.
- Whether any later station reads a file from the pushed branch on another machine (an uncommitted `.cell/` file would not be there; `.cell/` was never committed, so expected: no).

## Open decisions

- How to identify the committing station: (a) station named by `deliver.commit` (default, data-driven, no schema change; also validate that field), (b) operator profile name `builder` (brittle), (c) new `commits: true` field on a station (explicit but changes the line schema and all line files). Choose (a) unless verification shows a line without `deliver.commit`.
- Discard vs fail when a read-only station dirtied the tree. Default: discard and log. Pick fail only if you find a line where discarding hides real work.

## Implementation plan

1. Git port methods and adapter, with tests against a real temporary git repo.
2. Resolve the committing station id from the line snapshot; pass a `commits: boolean` decision into the complete path.
3. Non-committing path: discard, log, report `headSha`.
4. Tests: black box through the Cell run with fake ports plus the real-git adapter test.

## Acceptance criteria

- [ ] A run of a plan-only station creates no commit and no push.
- [ ] A read-only or inspection station that dirties the tree leaves no change behind and logs the discard.
- [ ] The builder creates exactly one commit per attempt and pushes it; a retry commits on top of the previous attempt.
- [ ] `headCommitSha` in HQ equals the base commit until the first build completes.
- [ ] `.cell/` files survive `discardChanges` and `clean`.
- [ ] Tests as described, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
