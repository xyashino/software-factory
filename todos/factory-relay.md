---
status: queued
priority: high
line: feature
type: feat
depends_on: factory-hq-link
---

# factory-relay: Cells talk only to the Factory, which relays to HQ

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

A Cell never learns the HQ URL or any HQ credential. It talks to the Factory daemon on loopback; the daemon forwards to HQ using the machine credential and swaps in the real Cell session. The daemon enrolls Cells on their behalf, re-enrolls a Cell once on an upstream 401, and records which Factory owns each Cell in HQ.

## Current state (verified)

- A Cell is started by `startCell` (`apps/sf/src/application/procedures/cell/start.procedure.ts`): it resolves its project and repo (`resolveCellTarget`), lists installed runners and line files, reads a persisted session from `ports.cellState` (file `cellStatePathOf(name)` under the repo's `.factory-local`, `apps/sf/src/config.ts:72`, `bootstrap/context.ts:62`), enrolls with `POST /api/v1/cells/enroll` using a join token if no session exists, then `hello`, then the claim loop. All calls go through `ports.server.call|get|remove` (`adapters/http/server-client.ts`), which sends `${baseUrl}${route}` with `authorization: Bearer <token>`. Claims long-poll up to `waitMs` (25 s).
- The Cell's HQ URL and token come from the connection resolver (`FACTORY_URL`, `FACTORY_TOKEN`, config files). `local-create.procedure.ts` copies them into the child's env today, so every Cell holds credentials.
- HQ derives the Cell identity from the token principal (`ctx.principal.cellId`) in `claim-job`, `heartbeat-cell`, `hello-cell`, `leave`, transitions.
- HQ enroll: `apps/hq/src/application/procedures/cells/enroll-cell.procedure.ts` (scope `cell:enroll`, creates the `cells` row, mints a `cell_session` token valid 30 days).
- The Cell routes the Cell calls (7 `server.call` sites plus hello): under `/api/v1/cells/*` (enroll, hello, claims, heartbeats, leave), `/api/v1/jobs/*` (transitions), `/api/v1/incidents/*/resolve`. List the exact set with `git grep -n "server.call(\|server.get(\|server.remove(" -- apps/sf/src/application/procedures/cell` before building the allowlist.
- After `factory-hq-link` the daemon has an HQ credential (`factory.json`, scope `factory:worker`) and a heartbeat, but no relay.

## Target behavior

Daemon relay (loopback only, same listener or a second loopback port; Cells get its URL as their "HQ URL"):

- For each Cell it spawns, the daemon creates a random local token (32 random bytes, hex) held in memory only, and gives the Cell env `FACTORY_URL=<relay url>` and `FACTORY_TOKEN=<local token>`. The Cell receives no HQ URL, no HQ token, no join token.
- Enroll interception: when the Cell calls `/api/v1/cells/enroll`, the daemon calls HQ enroll with the Factory credential, using a random Cell name (`cell-<8 hex>`), stores the returned HQ `sessionToken` in memory keyed by the Cell's local token, and returns `{ cellId, sessionToken: <local token>, expiresAt }` to the Cell. The Cell code stays unchanged.
- Every other request: allowlist of the Cell routes above (anything else: 403). The daemon replaces `authorization` with the stored HQ session token and forwards to HQ, streaming the response. Long-poll timeouts must cover `waitMs` as `server-client.ts` does.
- Upstream 401 for a Cell session: the daemon enrolls that Cell again once (same name, Factory credential), swaps the token and retries the request. A second failure kills that Cell. A 401 for the Factory credential itself is handled by `factory-hq-link` (stop and tell the user to reconnect).
- The Cell must not persist its session between runs: point `cellState` at a per-run path inside the daemon's data dir (or skip persistence when running under a daemon). A stale file must never be read as a session.
- HQ: add nullable `cells.factory_id` (migration). `POST /api/v1/cells/enroll` also accepts scope `factory:worker` and records the calling Factory. `GET /api/v1/cells` shows the owning Factory.
- Local tokens are revoked when the Cell exits.

## Scope

- **Target**: `apps/sf` (daemon relay, Cell start env, cellState path), `apps/hq` (enroll scope, `factory_id` column), `packages/hq-contracts`
- **Classification**: `Integration`, `Security`
- **Out of scope**: removing per-Cell tokens and `cells` rows in HQ (todo `cell-identity-slim`), the gone-Cell transaction, one shared long-poll for all Cells.

## Verify first

- How `ports.connection` and `ports.server` are built (`bootstrap/context.ts`) so the Cell can use the relay URL without code changes.
- Whether SSE or streaming routes (`stream`) are used by the Cell; if yes, the relay must stream them.
- How HQ checks scopes (`scopedProcedure`) so `factory:worker` can be added to enroll without widening other routes.

## Open decisions

- Same listener (path prefix, e.g. `/hq`) vs a second loopback port for the relay. Default: a path prefix on the daemon listener; confirm `server-client.ts` builds URLs by plain concatenation so a prefix works.

## Implementation plan

1. HQ: migration for `factory_id`, enroll scope, list shows factory, tests.
2. Daemon: relay with token map, enroll interception, allowlist, header swap, one re-enroll on 401, local token revocation.
3. Cell start: env contract, per-run session path.
4. Tests (black box, fake HQ server): a Cell run has no HQ URL or token in its env; a request outside the allowlist gets 403; an upstream 401 triggers exactly one re-enroll and the request succeeds; a second 401 kills the Cell; the local token stops working after the Cell exits; HQ shows the owning Factory.

## Acceptance criteria

- [ ] The Cell process environment and files contain no HQ URL, HQ token or join token.
- [ ] Only allowlisted routes pass the relay.
- [ ] One re-enroll on upstream 401, then the Cell is killed.
- [ ] No stale session file is ever reused.
- [ ] HQ records the owning Factory for each Cell.
- [ ] Tests as described, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
