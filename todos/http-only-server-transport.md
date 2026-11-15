---
status: todo
priority: medium
depends_on: [http-only-operator-endpoint]
line: feature
factory: v2
plan: http-transport
type: refactor
---

# http-only-server-transport: Unify `factory-server`, `factory` CLI, and `factory-cell` on HTTP

## Objective

Remove the Unix domain socket transport (`factory.sock`) and unify all `factory-server` communication (`factory` CLI, `factory-cell`, and remote clients) onto the single HTTP + SSE transport (`apps/server/src/http/`), simplifying the codebase and making local mode work natively on Windows as well as Linux/macOS.

## Read first

- `apps/server/src/main.ts`, `usage.ts`, `http/{app,config,listener}.ts`, `socket/{listener,serve,client}.ts`
- `apps/cli/src/context.ts`, `config.ts`, `usage.ts`, `client/{transport,socket,remote,feed}.ts`
- `apps/cell/src/main.ts`, `config.ts`, `factory-client.ts`, `remote-client.ts`, `usage.ts`
- `packages/factory-core/src/contracts/{routes,http-routes,http-codec}.ts`
- `docs/PLAN.md`, `docs/PROTOCOL.md`, `docs/STORAGE.md`

## Deliverables

1. **Single HTTP server listener in `apps/server`:**
   - Start the Hono HTTP + SSE listener unconditionally on `factory-server` startup (default `127.0.0.1:7878`, configurable via `FACTORY_BIND` / port `0` for tests), removing `FACTORY_REMOTE=1` gating and `apps/server/src/socket/{listener,serve,client}.ts`.
   - For local clients on the same machine, write the active server URL and an auto-generated local supervisor credential into `$FACTORY_DATA_DIR` (e.g. `server.json` or `local-url` + `local-token` with `0600` on POSIX) on startup and remove on clean shutdown, so local `factory` CLI and local `factory-cell` connect over HTTP without manual `FACTORY_TOKEN` setup.
   - Ensure `supervisor/events` SSE stream (`GET /v1/stream`) covers all CLI live views (`status --watch`, `log -f`).
2. **Unified HTTP clients in `apps/cli` and `apps/cell`:**
   - Remove `apps/cli/src/client/socket.ts` and `socketFactoryClient` in `apps/cell/src/factory-client.ts`; route both local (reading `$FACTORY_DATA_DIR` discovery/token) and remote (`FACTORY_URL` / `FACTORY_TOKEN` or `factory_url` / join credential) modes through the single HTTP client.
   - Keep `factory-server --once` (or in-process fallback when no server is running) working over JSON stdin/stdout without Unix sockets.
3. **Docs, Tests & ADR:**
   - Update `docs/PLAN.md`, `docs/PROTOCOL.md`, `docs/STORAGE.md` to reflect HTTP-only transport.
   - Remove obsolete socket-only tests (`socket.test.ts`, `socket-client.test.ts`, `no-network.test.ts`) and migrate `process.test.ts`, `factory.process.test.ts`, `integration.test.ts`, `e2e/*.test.ts`, and `distributed/harness/*` to localhost HTTP.
   - Record one ADR entry in `decisions/`.

## Acceptance criteria

- [ ] `factory-server`, `factory` CLI, and `factory-cell` use HTTP + SSE exclusively for both local (`127.0.0.1`) and remote communication; no `factory.sock` or `node:net` Unix socket code remains.
- [ ] Local CLI (`factory status`, `factory show`, `factory todos migrate`, etc.) works out of the box against a running `factory run` without manually setting `FACTORY_TOKEN`.
- [ ] No `fetch(..., { unix })` or Unix socket path limits remain anywhere in `apps/`.
- [ ] `pnpm ci:verify` passes.
