---
status: todo
priority: medium
depends_on: []
line: feature
factory: v2
plan: http-transport
type: refactor
---

# http-only-operator-endpoint: Replace Cell `op.sock` Unix socket with localhost HTTP

## Objective

Replace the per-Cycle Unix domain socket (`op.sock`) between `apps/operator-cli` (`factory-operator`) and `apps/cell` with an ephemeral localhost HTTP server (`http://127.0.0.1:<port>`), removing OS socket-path length limits (`MAX_SOCKET_PATH`), `chmod 0600` assumptions, and enabling Windows compatibility.

## Read first

- `apps/cell/src/operator-socket.ts`
- `apps/cell/src/jobs/run-operator-station.ts`
- `apps/cell/src/jobs/run-mechanic.ts`
- `apps/cell/src/names.ts`
- `apps/operator-cli/src/cli.ts`, `client.ts`
- `apps/operator-cli/src/__tests__/` (`cli.test.ts`, `stub-cell.ts`, `smoke.test.ts`)
- `apps/cell/src/__tests__/unit/operator-socket.test.ts`
- `docs/PROTOCOL.md` (§3.3)

## Deliverables

1. **Cell localhost HTTP operator endpoint (`apps/cell`):**
   - Replace `startOperatorSocket` (`node:net` Unix socket) in `apps/cell/src/operator-socket.ts` with a localhost HTTP server bound to `127.0.0.1` port `0` (OS-assigned ephemeral port).
   - Keep constant-time `FACTORY_CYCLE_TOKEN` verification (`Authorization: Bearer <token>` or JSON `token` field) and `operatorRequestSchema` Zod validation, returning `OperatorReply` JSON with appropriate HTTP status codes.
   - Pass `FACTORY_OPERATOR_URL` (e.g. `http://127.0.0.1:<port>`) and `FACTORY_CYCLE_TOKEN` to operator and mechanic runners in `run-operator-station.ts` and `run-mechanic.ts` instead of `FACTORY_OPERATOR_SOCKET` / `op.sock`.
   - Remove the `MAX_SOCKET_PATH` restriction and `cycleDirName` socket-path length constraint.
2. **Operator CLI HTTP client (`apps/operator-cli`):**
   - Update `apps/operator-cli/src/client.ts` and `cli.ts` to read `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN`, sending `POST` JSON requests via `fetch` instead of `node:net` Unix socket connections.
3. **Docs & Tests:**
   - Update `docs/PROTOCOL.md` (§3.3) to document the localhost HTTP Operator API.
   - Update `apps/cell/src/__tests__/unit/operator-socket.test.ts`, `apps/operator-cli/src/__tests__/{cli,stub-cell}.test.ts`, and `apps/cell/src/__tests__/e2e/station.test.ts`.
   - Record one ADR entry in `decisions/`.

## Acceptance criteria

- [ ] `factory-operator` communicates with `factory-cell` exclusively over `http://127.0.0.1:<port>` (`FACTORY_OPERATOR_URL`) with `FACTORY_CYCLE_TOKEN`.
- [ ] No `op.sock` Unix socket file or `MAX_SOCKET_PATH` check remains in `apps/cell` or `apps/operator-cli`.
- [ ] Unauthorized/invalid tokens are rejected in constant time.
- [ ] `pnpm ci:verify` passes.
