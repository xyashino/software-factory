---
status: todo
factory: v2
plan: factory-cli
depends_on: [cli-02-contracts, cli-03-procedure-core]
priority: high
line: feature
type: feat
---

# Todo: `cli-04-server-client-and-server-commands` — HTTP Client and `factory server`

## 🎯 Objective

Build the HTTP adapter that every supervisor and Cell procedure uses, and the `factory server start`, `stop` and `token create` commands. After this step, the CLI can start the server and talk to it.

---

## 🌐 Context & Problem Statement

- Every supervisor command maps to one server route (PLAN §1). They all need the same client: base URL, bearer token, JSON body, error mapping.
- `factory server stop` must stop only the server process. Cells keep running and retry (PLAN §8.4). This is a hard rule and a test case.
- The server's own admin entry is `bun src/index.ts admin token create` (`apps/factory-server/src/index.ts`). The CLI wraps it, so the admin path is not duplicated.
- The supervisor token must never be printed (PLAN §5).

---

## 📦 Specification / Scope

- **Target**: `apps/factory/src/adapters/http/`, `apps/factory/src/adapters/process/`, `apps/factory/src/adapters/fs/`, `apps/factory/src/adapters/cli/`, `apps/factory/src/application/procedures/server/`.
- **Classification**: `Integration`.
- **Files to create**:
  - `src/adapters/http/server-client.ts` (implements `ServerPort`)
  - `src/adapters/http/map-reply.ts` (HTTP status and body to `Refused` / `Unreachable` / ok)
  - `src/adapters/fs/token-file.ts` (implements `TokenStorePort` for the supervisor token: `FACTORY_TOKEN` or `~/.config/factory/token`)
  - `src/adapters/fs/pid-file.ts` (`$FACTORY_DATA_DIR/server.pid`)
  - `src/adapters/process/spawn-server.ts` (implements part of `ProcessPort`)
  - `src/adapters/cli/output.ts` (table and `--json` printing, no colour when not a TTY)
  - `src/adapters/cli/server.command.ts`
  - `src/application/procedures/server/start.procedure.ts`
  - `src/application/procedures/server/stop.procedure.ts`
  - `src/application/procedures/server/token-create.procedure.ts`
  - `test/blackbox/server-commands.test.ts`
- **Dependencies**: none added.

---

## 🛠️ Implementation Plan

1. **`server-client.ts`**:
   - Base URL from `FACTORY_URL` (default from `config.ts`).
   - `call(route, body, token)`: one request per call, `Authorization: Bearer <token>`, `content-type: application/json`.
   - Network failure or timeout throws `Unreachable` (exit `3`).
   - No automatic retry in this adapter. Retry with the same `commandId` is a Cell concern (cli-08).
2. **`map-reply.ts`**:
   - `200` or `201` returns the parsed body.
   - `400`, `401`, `403`, `409`, `500` throw `Refused` with `code: message` from the body.
   - Unreadable body throws `Unreachable`.
3. **`factory server start`**:
   - Reads `FACTORY_DB_PATH` and `FACTORY_PORT` from the environment, with the server's defaults.
   - Spawns `bun apps/factory-server/src/index.ts` as a detached child, stdio to `$FACTORY_DATA_DIR/server.log`.
   - Writes the child pid to `server.pid` (`0600`).
   - Waits until `GET` on the base URL answers (any status), with a 10 s limit. If not, exit `3`.
   - Refuses to start if `server.pid` names a live process (exit `1`, message `server already running`).
4. **`factory server stop`**:
   - Reads `server.pid`, sends `SIGTERM`, waits up to 10 s, then reports.
   - Does **not** call any `cells` route. Does not touch Cell processes or Cell state.
   - No `server.pid` means exit `0` with `server not running`.
5. **`factory server token create`**:
   - Runs `bun apps/factory-server/src/index.ts admin token create` with the same `FACTORY_DB_PATH`.
   - Prints the token once. With `--save`, writes it to the token file (`0600`). Never prints it otherwise.
6. **Output**: `--json` prints the procedure result as JSON; default prints one line per result.

---

## ✅ Acceptance Criteria

- [ ] `factory server start` starts the server and `GET /` answers.
- [ ] A second `factory server start` refuses while the first runs (exit `1`).
- [ ] `factory server stop` ends the server process and leaves `server.pid` removed.
- [ ] A test proves `server stop` sends no request to `/api/v1/cells/*` (fake server records requests).
- [ ] `server token create` prints the token exactly once; with `--save` it writes the file and prints nothing more.
- [ ] A network failure exits `3` with one request attempted.
- [ ] A `401` from the server exits `1` and prints `code: message`.
- [ ] The supervisor token never appears in logs, stdout (except the one `token create` print), or error text.
- [ ] No barrel file; no `any`.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md): start, stop and failure output captured.
