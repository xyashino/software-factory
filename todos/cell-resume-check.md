---
status: queued
priority: high
line: feature
type: feat
depends_on: checkpoint-builder-only
---

# cell-resume-check: resume from the last build commit or start over

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

When a Cell claims a job whose order already has a worktree on this machine, it resumes from a known clean state: reset the worktree to the order's last committed state, rerun the interrupted station. If anything needed is missing or broken, delete the worktree and report `worktree_missing` so HQ restarts the order from scratch.

## Current state (verified)

- Workspace preparation is the function around `apps/sf/src/application/procedures/cell/run-job.procedure.ts:712-760`: if `<repo>/.worktrees/<orderSlug>` exists it logs `worktree reuse` and uses it as is; otherwise `git worktreeAdd(repoRoot, worktree, factory/<slug>, job.baseBranch)`. Then `excludeLocally(.cell/)`, write `.cell/worktree.json` (`projectId`, `orderId`, `planId`, `baseBranch`, `baseCommitSha`, `cellId`), run the line's `setup` commands.
- The missing-file check is at `:278-300`: for jobs with `expectedPriorSteps` it requires `.cell/worktree.json` and `.cell/<stationId>/state.json` for every prior step. Missing files are reported by `worktreeMissingOf` (`:610`) as transition `worktree_missing { missingStepId, missingFiles }`.
- HQ handles it in `transition-job.procedure.ts:911-956`: `planWorktreeMissing(order.worktreeResets)`; resets the order to step 0 with a `fresh` workspace; cap `MAX_WORKTREE_RESETS = 2` (`apps/hq/src/config.ts`); beyond the cap it raises an incident.
- There is no `git reset` or `clean` anywhere in `apps/sf` today. A reused worktree keeps whatever a killed station left in it (half-edited files).
- The claimed job DTO (`packages/factory-contracts/src/cells.contract.ts`, `claimedJobDto`) has `workspaceMode`, `epoch`, `baseBranch`, `baseCommitSha`, `targetBranch`, `expectedPriorSteps[{stepId, stationId, stepIndex, requiredFiles}]`. It has no `headCommitSha`; HQ stores it on the order (`apps/hq/src/db/schema/orders.ts:62`).
- HQ sets `workspaceMode: 'fresh'` only when `currentStepIndex === 0 && worktreeResets === 0`, otherwise `reuse` (`claim-job.procedure.ts:284-287`).
- Today the Cell always sends `localWorktrees: []` in hello (`start.procedure.ts`), so HQ's worktree-affinity in claiming (`selectClaimable`) is effectively unused. Not part of this todo.
- Builder commits are pushed to `origin factory/<slug>`, but read-only step files (`.cell/<station>/*`) are never committed, so a worktree cannot be rebuilt from `origin` alone. Scratch restart is therefore required when the local worktree is unusable.

## Target behavior

Decision table when a job arrives with `workspaceMode: 'reuse'`:

| Situation | Action |
| --- | --- |
| Worktree missing, step index 0 | Create it normally (nothing to resume) |
| Worktree missing, step index > 0 | Report `worktree_missing` (HQ resets to step 0) |
| Worktree exists, any required `.cell/` file missing | Delete the worktree, report `worktree_missing` |
| Worktree exists, files complete, `headCommitSha` known and present locally | `resetHard(headCommitSha)`, `clean` (no `-x`), clear the current station's stale `.cell/<station>` files, run the station |
| Worktree exists, `headCommitSha` unknown to this clone, or reset or clean fails | Delete the worktree, report `worktree_missing` |

Rules behind it:

- `headCommitSha` = the order's last committed state: the base commit before the first build completes, the last build commit after. A retry build therefore starts on the previous attempt's commit, not on the base.
- Add `headCommitSha: string | null` to `claimedJobDto`; HQ fills it from `order.headCommitSha ?? order.baseCommitSha`. Update HQ claim, resume and contract tests.
- `git reset --hard` and `git clean -fd` do not touch the ignored `.cell/` directory. Never use `-x`.
- Deleting a worktree uses `git.worktreeRemove` and falls back to removing the directory, then `git worktree prune`.
- Resume only applies on the same PC and repo (the worktree is local). A different machine finds no worktree and takes the "missing" row.
- A Cell being gone does not count toward `MAX_WORKTREE_RESETS`; only a real `worktree_missing` report does (HQ side, todo `cell-gone-transaction`).

## Scope

- **Target**: `apps/sf` (run-job workspace preparation), `apps/hq` (claim DTO), `packages/factory-contracts`
- **Classification**: `Domain logic`
- **Out of scope**: watching for a deleted worktree while a Cell runs (`factory-workspace-watch`), killing Cells, rebuilding a worktree from `origin`.

## Verify first

- That `resetHard`, `clean`, `hasCommit` exist on `GitPort` after `checkpoint-builder-only` (it adds them); if not, add them here.
- That `completedStepIds` or similar data is not needed by HQ for this (hello still sends `[]`).
- That the claim code path used for resuming an existing job (`resumeReadyJob`, `claim-job.procedure.ts`) also fills `headCommitSha`.

## Open decisions

- None. Default: `headCommitSha` from the order, as above.

## Implementation plan

1. Contract and HQ: add `headCommitSha` to the claimed job; update claim and resume paths and contract tests.
2. Cell: replace "reuse as is" with the decision table; keep log lines (`worktree reuse`, `worktree reset to <sha>`, `worktree discarded: <reason>`).
3. Tests with a real temporary git repo: kill during build (dirty tree) resets to the build commit; kill in a read-only step reruns the step and keeps earlier step files; unknown commit deletes the worktree and reports `worktree_missing`; `.cell/` files of finished steps survive the reset.

## Acceptance criteria

- [ ] Killed during the first build: reclaimed worktree equals the base commit and the build reruns.
- [ ] Killed during a retry build: reclaimed worktree equals the previous build commit.
- [ ] Killed in a read-only station: station reruns, files of earlier stations are kept.
- [ ] Missing `.cell/` file or unknown commit: worktree deleted and order reset to step 0.
- [ ] Tests as described, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
