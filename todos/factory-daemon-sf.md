---
status: queued
priority: high
line: feature
type: feat
---

# factory-daemon-sf: local Factory daemon inside sf, replaces cell-server

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

Add `sf factory start|stop|status`: one local daemon per user per PC that spawns, lists and kills Cell processes. It replaces cell-server (`apps/cell`) and the `slots.json` slot files. This todo builds the daemon skeleton only: lifecycle, loopback API, Cell supervision. No HQ link yet (todos `factory-hq-link`, `factory-relay`).

## Current state (verified)

Two local managers exist today:

1. **Direct slots** (ADR `decisions/20261121-143000-factory-unify-single-machine-cells.md`): `sf cell create [--count N] [--name slug] [--lines a,b] [--repo path] [--json]` (`apps/sf/src/adapters/cli/cell.command.ts`, `application/procedures/cell/local-create.procedure.ts`). It mints a `cell_join` token per slot, spawns a detached `sf cell start --name <slot>` with env `FACTORY_URL`, `FACTORY_TOKEN`, the join token (`JOIN_TOKEN_ENV`) and `CELL_LINES`. Slot list is `$XDG_DATA_HOME/sf/cells/slots.json` (mode 0600, atomic write) plus per-slot `<slotId>.pid` and `<slotId>.log` (`adapters/fs/local-slot-store.ts`, `local-pid.ts`). Other local commands: `local-list`, `local-stop` (SIGTERM, waits up to 10 s), `local-rm`.
2. **cell-server** `apps/cell` (`@repo/cell`): detached Bun process started by `sf cell server start`, default `127.0.0.1:7071`, own SQLite `$XDG_DATA_HOME/sf/cell-server.db`, own workspaces dir, settings (`CELL_SERVER_HOST`, `CELL_SERVER_PORT`), HQ targets ("factories" in its code means HQ URLs) in `~/.config/sf/config.json`. Routes and procedures: cells (create, list, remove, start, stop, stop-all, reconcile-running-slots, slot-runtime), factories (list, upsert, remove, set-default, sync-shared), health, settings. A slot row has `slotId`, `name`, `factoryId`, `repoRoot`, `cellId`, `sessionToken`, `logPath`, `desiredState`, `runtimeStatus`, `pid`, `lastError`. `sf` reaches it through `application/procedures/cell-server/*`, `application/ports/cell-server.port.ts`, `@repo/cell-contracts`. Internal re-exec markers for the compiled binary: `CELL_SERVER_MARKER`, `SERVER_MARKER`, `WEB_MARKER` in `apps/sf/src/config.ts` and `bootstrap/server-dispatch.ts`.
- `sf cell` subcommands today: `start`, `list`, `stop`, `revoke`, `create`, `rm`, `server`.
- `docs/cell.md` says the two launch paths are not shared. The ADR above removed the need for cell-server on a single machine because two servers had separate DBs and duplicate HQ targets.
- A Cell process today does not notice if its supervisor dies.
- `sf service` (`adapters/cli/service.command.ts`, `adapters/fs/service-units.ts`) writes systemd user units; check whether it references cell-server.

## Target behavior

- `sf factory start`: starts a detached daemon (same self re-exec pattern as the server and cell-server, with a new marker) listening on `127.0.0.1:<port>`; default port 7072, override with env `SF_FACTORY_PORT` (not 7071, so a stale cell-server cannot be mistaken for it). Writes a pid file. A second start refuses and prints the running pid. `status` must verify the listener is its own process (health response carries the daemon pid), not just any listener on the port.
- `sf factory stop`: stops the daemon, which first kills all its Cells (confirmed exit), then exits.
- Loopback API (internal, used by `sf` only, never exposed): `GET /health`, `GET /cells`, `POST /cells` (`{ repoRoot, lines? }` start one Cell), `DELETE /cells/:cellId`. `cellId` here is a random id chosen by the daemon.
- Supervision: spawn `sf cell start` as a child with the same env as `local-create` builds today. Track pid and exit. `kill(cellId)` sends SIGTERM, waits up to 10 s, then SIGKILL, and resolves only after the process has exited.
- The daemon owns Cell logs: `$XDG_DATA_HOME/sf/cells/<cellId>.log` (outside any worktree).
- A Cell exits by itself when its parent daemon disappears (compare `process.ppid` on each heartbeat tick or a 1 s timer). A killed daemon must not leave workers running.
- `sf cell create|list|stop|rm` call the daemon API instead of `slots.json`. If the daemon is not running they fail with `factory not running: run "sf factory start"`. `slots.json` and old slot files are ignored (no migration).
- Delete `apps/cell`, `packages/cell-contracts`, `sf cell server`, `application/procedures/cell-server/*`, `cell-server.port.ts`, the `CELL_SERVER_*` markers and config, and update `README.md`, `docs/architecture.md`, `docs/cell.md`, `docs/sf.md`, lint rules that mention them (`apps/cell/eslint.config.mjs` goes with the app).
- The daemon keeps no state on disk except its pid file. The Cell list lives in memory.

## Scope

- **Target**: `apps/sf` (new `factory` command, daemon entry and API, supervisor), delete `apps/cell` and `packages/cell-contracts`
- **Classification**: `Architecture`
- **Out of scope**: HQ connection and credential, relay, `scale`, workspace watch, Cell identity changes, `sf service` unit changes (only fix it if it breaks).

## Verify first

- `git grep -n "cell-contracts\|apps/cell\|cell-server\|CELL_SERVER" -- . ':!decisions'` to list every dependent before deleting.
- How the compiled `sf` binary re-executes itself for the server (`IS_COMPILED`, `*_MARKER`) so the daemon works in both dev and compiled modes.
- Existing blackbox tests for `cell create|stop|list` (`apps/sf/test/blackbox/cell-*.test.ts`) and what fake process or clock ports they use.
- Whether `sf service` or `sf setup` start cell-server; update them to start the daemon or leave a clear TODO-free error.

## Open decisions

- Default port 7072 (default) vs reuse 7071.
- Delete `apps/cell` in this todo (default) vs a follow-up. If the diff is too large, split deletion into its own todo and keep both until then, but do not add features to `apps/cell`.

## Implementation plan

1. Daemon entry, loopback Hono app, supervisor (ports: process, clock, fs for pid and logs), `factory.command.ts`.
2. Rewire `cell create|list|stop|rm` to the daemon; parent-death exit in `sf cell start`.
3. Delete cell-server and cell-contracts; fix docs.
4. Tests (black box): second start refuses with the pid; `stop` kills Cells and exits; `kill` resolves only after exit; killing the daemon makes Cells exit; `cell create` without a daemon fails with the hint; `status` ignores a foreign listener.

## Acceptance criteria

- [ ] `sf factory start|stop|status` work; second start refuses naming the pid.
- [ ] Stopping or killing the daemon leaves no Cell process running.
- [ ] The daemon listens on loopback only.
- [ ] `apps/cell`, `packages/cell-contracts` and `sf cell server` are gone; `git grep cell-server` finds only ADRs.
- [ ] `sf cell create|list|stop|rm` work through the daemon.
- [ ] Tests as described, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/` that supersedes `20261121-143000` where it conflicts.
- [ ] `bun run ci:verify` passes.
