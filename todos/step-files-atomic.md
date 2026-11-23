---
status: queued
priority: high
line: standard
type: fix
---

# step-files-atomic: step files are complete or absent, never half written

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

Every file the Cell writes under `.cell/` is written atomically, and the "step complete" marker is written last. Then "the file exists" can be trusted by the resume check (todo `cell-resume-check`).

## Current state (verified)

- `FsPort.writeText(path, text, mode?)` (`apps/sf/src/application/ports/fs.port.ts`) is implemented by `writeTextFile` in `apps/sf/src/adapters/fs/write-text.ts`: `mkdirSync` then `writeFileSync` straight to the final path. A kill mid-write leaves a truncated file.
- Atomic write (write `<path>.tmp-<pid>` then rename) already exists for slots and connection files: `adapters/fs/local-slot-store.ts:38` (`writeAtomic`) and `adapters/fs/connection-store.ts:42`. Not used for `.cell/` files.
- Writers in `apps/sf/src/application/procedures/cell/run-job.procedure.ts` (line numbers approximate): feedback file `:470`, `state.json` `:512`, setup log `:707`, `.cell/worktree.json` `:746`, `task.md` `:892`, operator prompt `:896`, runner file `:1083`, mechanic prompt `:1310`, incident report `:1339`.
- `state.json` content: `{ jobId, epoch, outcome: 'complete' }`. It is written at `:512` BEFORE `checkpointStation` runs (`:517-525`, may commit and push) and before the `complete` transition is sent to HQ.
- The resume check (`:278-300`, reports `worktree_missing`) treats a prior step as done when `.cell/<stationId>/state.json` exists. So today a kill between the `state.json` write and the commit leaves a "complete" marker without the commit.
- Log appends use `FsPort.appendText` and are not part of this todo.

## Target behavior

1. `writeText` is atomic for every caller: write to `<path>.tmp-<pid>` in the same directory (same filesystem), keep the requested file mode, then `rename`. Create parent dirs as today. `appendText` is unchanged.
2. In the complete path, write `state.json` only after `checkpointStation` succeeded (or was skipped) and the sha is known. A step marked complete on disk is always a step whose work is committed (builder) or finished (others).
3. When a step starts (also on rerun after a kill), remove that station's stale `state.json` and feedback file first, so a leftover marker from a previous attempt cannot count as completion.
4. On worktree reuse, remove leftover `*.tmp-*` files under `.cell/` so they never look like step output.

## Scope

- **Target**: `apps/sf/src/adapters/fs/write-text.ts`, `apps/sf/src/application/procedures/cell/run-job.procedure.ts`
- **Classification**: `Reliability`
- **Out of scope**: changing file names or contents; the resume decision itself; log files; HQ code.

## Verify first

- That the whole worktree and `.cell/` sit on one filesystem (rename is atomic only within one). They do: `.cell/` is inside the worktree.
- Whether any caller passes a `mode` that must survive the rename.
- Whether a station rerun already clears its dir; if yes, only add what is missing.

## Open decisions

- None. Default: make `writeTextFile` atomic for all callers (smallest change) instead of a second port method.

## Implementation plan

1. Change `writeTextFile` to temp-then-rename; keep the signature.
2. Move the `state.json` write below the checkpoint in the complete path; keep failure handling (`finishWithFail`) intact.
3. Clear the station's stale `state.json` and feedback at step start.
4. Remove stale `.tmp-*` under `.cell/` when a worktree is reused.
5. Tests: black box through the Cell run (existing fake ports in `apps/sf/test`): fake `fs` that throws between temp write and rename leaves no file at the final path; kill-after-checkpoint-before-state leaves no `state.json`; a stale `state.json` from an earlier attempt is gone when the step restarts.

## Acceptance criteria

- [ ] A write interrupted before the rename leaves no file at the final path and no readable partial content.
- [ ] `state.json` exists only after the checkpoint finished.
- [ ] A rerun of a step starts without the old `state.json`.
- [ ] Tests as described, Arrange/Act/Assert, public behavior only.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
