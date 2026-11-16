---
scope: factory
summary: One HTTP transport for factory-server; drop factory.sock entirely
why: One transport works on Windows, drops Unix socket code, and keeps one client path
date: 2026-11-15
tags: [transport, http, socket, server, cli, cell, windows]
---

- `factory-server` always starts the Hono HTTP + SSE listener.
  - Default `127.0.0.1:7878`; `FACTORY_BIND` sets another address, port `0` picks a free one for tests.
  - `FACTORY_REMOTE=1` and the Unix socket listener are removed; `apps/server/src/socket/` is gone.
- On start the server writes `$FACTORY_DATA_DIR/server.json` (`url`, `token`, `joinToken`).
  - The write is atomic, with mode `0600` on POSIX.
  - A clean shutdown removes it, but only while it still names this server's token.
  - The shape and parser live in `factory-core` (`contracts/discovery.ts`); the CLI and Cell read it.
- The local supervisor token is minted per start and checked in memory only.
  - Nothing stores it, so nothing needs revoking.
  - It satisfies `supervisor` routes and the new `local` credential class.
- The local join token is a runtime join token, minted per start with a 24 h TTL and revoked on clean shutdown.
  - A local Cell joins once over HTTP and keeps its credential.
  - That is the same path a remote Cell takes.
- `adminBackup` moves to `POST /v1/admin/backup` with auth `local`.
  - Only the local supervisor token reaches it, so a remote supervisor cannot make the server write a path.
  - It leaves `HTTP_UNMAPPED`.
- The CLI has one client, `remoteFactoryClient`.
  - Local mode points it at the discovery URL and token; remote mode at `FACTORY_URL` and `FACTORY_TOKEN`.
  - `ServerUnreachable` is the only signal that falls back to `--once`; a refusal never does.
- The Cell's socket client is removed.
  - The local connect path now uses the remote Cell client with a discovered join token.
- Removed: `factory.sock`, `socketFactoryClient` (CLI and Cell), `fetch(..., { unix })`, `socket.test.ts`, `socket-client.test.ts`, `no-network.test.ts`.
  - A source guard (`apps/server/src/__tests__/transport.test.ts`) fails on any `factory.sock`, `unix:` option or socket client name in app source.
- Trade-off: a local account that can read `server.json` can call the server as supervisor, as it could reach the socket before.
  - Loopback stays the default bind.
  - On Windows the file's mode is not enforced.
- Trade-off: a server that crashes leaves `server.json` behind.
  - Clients find it unreachable and take the `--once` path, as they did with a stale socket.
  - A second server replaces the file.
