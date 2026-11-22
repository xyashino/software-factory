---
status: queued
priority: high
line: feature
type: feat
depends_on: factory-daemon-sf
---

# factory-hq-link: Factory enrolls with HQ and notices when HQ is gone

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

The Factory becomes a registered machine in HQ. `sf factory connect <url> --token <join>` exchanges a one-time join token for a machine credential kept in one `0600` file. The daemon heartbeats HQ and kills all its Cells after 45 s without HQ. A rejected credential (401) stops the daemon from talking to HQ until the user connects again. Relaying Cell traffic is the next todo (`factory-relay`).

## Current state (verified)

- HQ has no machine entity. Tokens live in table `safeTokens` (`apps/factory/src/db/schema/tokens.ts`); kinds: `supervisor` (scopes `supervisor:read`, `supervisor:write`, `admin:tokens`), `cell_join` (`cell:enroll`), `cell_session` (`cell:worker`, 30 days, `CELL_SESSION_TTL_MS`), `web_join`, `web_session`. Defaults and prefixes: `application/tokens/token-writes.ts`, `token-hash.ts` (`TOKEN_PREFIXES`). Operators create tokens with `sf token create --kind <kind> --name <name>`; `createToken` is in `apps/sf/src/application/procedures/tokens/token-create.procedure.ts`.
- `POST /api/v1/tokens/join` is the WEB join (loopback only, exchanges a `web_join` secret for a `web_session`). It is not the Cell join. Cells enroll with `POST /api/v1/cells/enroll` using a `cell_join` token (`enroll-cell.procedure.ts`).
- Where an `sf` command finds the HQ URL and token today: env `FACTORY_URL`/`FACTORY_TOKEN`, global config `~/.config/sf/config.json`, repo token file, legacy `~/.config/factory/token` (`adapters/fs/connection-store.ts`, `token-file.ts`; ADR `20261121-143000` lists the precedence). 401s were repeatedly caused by this spread.
- Constants (`apps/sf/src/config.ts`): `HEARTBEAT_INTERVAL_MS` 10 s, `LEASE_TTL_MS` 60 s, `SELF_FENCE_MS` 45 s (defined, currently unused in `apps/sf/src`).
- HQ routes are Hono routers in `apps/factory/src/adapters/hono/routes/*.route.ts`; procedures use `scopedProcedure([...scopes])(contract)(handler)`; contracts in `packages/factory-contracts`.
- The daemon from `factory-daemon-sf` exists, with no HQ knowledge.

## Target behavior

HQ:
- New table `factories`: `factoryId` (random), `name` (hostname), `lastSeenAt`, `createdAt`; migration in `apps/factory/src/db/migrations`.
- New token kinds `factory_join` (scope `factory:enroll`) and `factory_session` (scope `factory:worker`). `sf token create --kind factory_join` mints a one-time join token (consumed on use).
- `POST /api/v1/factories/enroll` (scope `factory:enroll`): returns `{ factoryId, sessionToken, expiresAt }`.
- `POST /api/v1/factories/heartbeat` (scope `factory:worker`): updates `lastSeenAt`.
- `GET /api/v1/factories` (supervisor): list with `lastSeenAt` and an `online` flag (seen within `LEASE_TTL_MS`).
- Contracts in `packages/factory-contracts/src/factories.contract.ts`.

sf and daemon:
- `sf factory connect <url> --token <join>` (also accept the token on stdin with `--token -`, never echo it): calls enroll, writes `$XDG_CONFIG_HOME/sf/factory.json` with mode `0600` and atomic write: `{ url, factoryId, sessionToken }`. This file is the only place the HQ machine credential lives. Re-running connect replaces it.
- Daemon reads the file at start. Not connected: it runs but reports `hq: not connected` in `status` and refuses to start Cells.
- Heartbeat every `HEARTBEAT_INTERVAL_MS`. On HQ unreachable for `SELF_FENCE_MS` (45 s) it kills every Cell (confirmed exit) and keeps retrying; Cells are not restarted automatically (hard rule 8).
- On 401 the Factory cannot recover alone (a join token is single use): mark `hq: credential rejected`, kill all Cells, stop retrying, and let `status` tell the user to run `sf factory connect` again. The one-time re-enroll on 401 exists only for Cell sessions, in `factory-relay`.
- `sf factory status` prints: daemon pid, HQ url, factoryId, `hq: ok | unreachable since <time> | credential rejected`, Cell count. No token in output.

## Scope

- **Target**: `apps/factory` (table, tokens, routes), `packages/factory-contracts`, `apps/sf` (command, daemon heartbeat, credential file)
- **Classification**: `Integration`
- **Out of scope**: relaying Cell calls, removing per-Cell tokens, reaping Cells when a Factory goes silent (HQ side, `cell-gone-transaction`), the `hq` rename.

## Verify first

- How `createToken` and `DEFAULT_SCOPES` need extending for the two new kinds, and how `TokenScope` is typed in `application/ports/auth.port.ts`.
- How join tokens are marked consumed today for `cell_join` (reuse the mechanism) and what `sf token create` prints.
- How drizzle migrations are generated in this repo (`db:check` runs in `ci:verify`; see `apps/factory/drizzle.config.*` and `db/migrations/index.ts`) and whether SQLite needs a table rebuild for what you add (a new table does not).

## Open decisions

- Factory session lifetime: default 30 days like Cells; it is replaced by running `connect` again.

## Implementation plan

1. HQ: schema, migration, token kinds, enroll, heartbeat, list routes, contract, tests (`apps/factory/test/blackbox`).
2. sf: `factory connect` command, credential file adapter (atomic, `0600`), daemon heartbeat loop with a fake clock port for tests.
3. Loss rule and `status` output.
4. Tests (black box): enroll consumes the join token; credential file mode is `0600`; heartbeat updates `lastSeenAt`; HQ down for 45 s kills Cells before 60 s; 401 stops the loop and kills Cells; no output contains a token.

## Acceptance criteria

- [ ] Join token works once; second use is rejected.
- [ ] Credential file has mode `0600`, contains no other secrets, and is the only place the HQ credential is stored by the daemon.
- [ ] With HQ unreachable, Cells are killed at 45 s, before HQ's 60 s lease expiry.
- [ ] A rejected credential kills Cells, stops retries, and the status tells the user to reconnect.
- [ ] `GET /api/v1/factories` shows the Factory with `online` true or false.
- [ ] Tests as described, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
