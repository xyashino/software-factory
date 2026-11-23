---
status: queued
priority: medium
line: fast
type: docs
---

# hq-rename-docs: new names in docs, help text and aliases

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

Docs and `sf` help text use the target names (HQ, Factory, Cell). Old command names and env vars keep working as aliases that print one deprecation line. No behavior change beyond that.

## Current state (verified)

- "Factory" names the external server everywhere: `apps/hq`, `docs/hq.md` (server design, long), `docs/README.md` glossary, `docs/architecture.md`, `docs/sf.md` (command tree), `docs/cell.md`, `docs/onboarding-plan.md`, root `README.md` (table lists `apps/cell` as "Cell server: runs Cell slots for a Factory").
- `docs/cell.md` says two processes are called "Cell": the Cell daemon (`sf cell start`) and cell-server (`apps/cell`). In the target, cell-server is replaced by the Factory daemon (todo `factory-daemon-sf`).
- `sf` top-level commands (`apps/sf/src/cli.ts`): `server`, `connect`, `target`, `todos`, `queue`, `incident`, `order`, `watch`, `operator`, `cell`, `web`, `init`, `project`, `token` (plus `setup`, `service`, `doctor` in newer code; check `cli.ts`).
- Commands that act on the external server: `server start|stop` and its token subcommand, `connect`, `target ls|use`, `token create`, `project add`.
- Env vars `FACTORY_URL` and `FACTORY_TOKEN` point at the external server. They are read in many places (about 69 and 36 occurrences when last counted).
- Danger: if `FACTORY_URL` ever meant the local daemon, an old setup would silently talk to the wrong server. Therefore the external server gets new names (`HQ_*`) and `FACTORY_*` is only an alias for now.

## Target behavior

1. Docs: external server is "HQ" everywhere; "Factory" means the local daemon; "cell-server" and "Cell Server" disappear except in historical ADRs. Update the glossary in `docs/README.md` first, then the other docs. Do not edit existing ADR files.
2. CLI: add `sf hq <sub>` carrying today's `server`, `connect`, `target`, `token` behavior. Keep the old top-level commands. When an old name runs, print once to stderr `deprecated: use "sf hq <sub>"` and then behave exactly as before (same output on stdout, same exit codes).
3. Env: read `HQ_URL` and `HQ_TOKEN` first. If unset, fall back to `FACTORY_URL` and `FACTORY_TOKEN` and print once per process to stderr `deprecated: FACTORY_URL, use HQ_URL`. Never print token values.
4. Help text: command descriptions in `apps/sf/src/adapters/cli/*.command.ts` use the target names.

## Scope

- **Target**: `docs/`, root `README.md`, `apps/sf/src/adapters/cli/*.command.ts`, `apps/sf/src/cli.ts`, env reading in `apps/sf/src/config.ts` and the connection resolver
- **Classification**: `Documentation`, `Interface`
- **Out of scope**: renaming binaries, packages, directories, DB columns, route paths, `FACTORY_*` vars that are not URL or token. Do not create `sf factory ...` here (todo `factory-daemon-sf`).

## Verify first

- Run `sf --help` and each of the commands above; list exactly which accept which flags so `hq` maps one to one.
- Find every read of `FACTORY_URL` and `FACTORY_TOKEN` (`git grep -n "FACTORY_URL\|FACTORY_TOKEN" -- apps packages`); route them through one resolver so the alias logic exists once.
- Confirm how citty (`defineCommand`) lets one command definition be mounted under two names.

## Open decisions

- Shape of the HQ commands: `sf hq start|stop|connect|target|token` (default) vs keeping `connect`, `target`, `token` at top level. Default: all under `hq`.

## Implementation plan

1. Docs pass (glossary first). Run `bun run docs:check` (link check) after.
2. `hq.command.ts` mounting the existing command definitions; register in `cli.ts`; deprecation wrapper for the old names.
3. One env resolver with the fallback and the once-per-process warning.
4. Tests (black box, spawn the CLI like existing tests in `apps/sf/test/blackbox`): old name warns and works; new name works silently; `HQ_URL` wins over `FACTORY_URL`; no token value ever appears in output.

## Acceptance criteria

- [ ] No doc outside `decisions/` calls the external server "Factory" or the local daemon "Cell Server".
- [ ] `sf hq <sub>` works for every old command; each old command prints exactly one deprecation line and still works.
- [ ] `HQ_URL` and `HQ_TOKEN` take precedence; fallback to `FACTORY_*` warns once.
- [ ] Tests as described, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/` that supersedes the naming of `20261113-120000-factory-nomenclature.md`.
- [ ] `bun run ci:verify` passes.
