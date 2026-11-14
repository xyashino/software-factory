---
scope: factory/remote
summary: Remote mode serves the same runtime over HTTP, SSE and hashed tokens
why: Machines off the Factory host reach it over TCP while local mode keeps the socket, OS trust and no network listener
date: 2026-11-14
tags: [v2, remote, http, sse, auth]
---

- Route table: `factory-core/contracts/http-routes.ts` maps every `ROUTES` key to a PROTOCOL §3 method and path, or lists it unmapped with a reason. Server, CLI and Cell all read that one table.
  - Unmapped: `supervisorEvents` (replaced by `GET /v1/stream`) and `adminBackup` (it writes a server file path, so it stays host-side).
- Codec: `factory-core/contracts/http-codec.ts` is pure. It encodes a route call to method, path and body, and decodes the answer; `refusalOf` turns an error body into `WireFailure`.
- Credentials: `factory-runtime/src/remote.ts` checks join tokens, supervisor tokens and Cell credentials by SHA-256 hash. The HTTP layer holds no token table; the socket keeps OS-account trust.
  - Each lookup returns the stored hash, and `sameHash` compares it with the presented one in constant time (`timingSafeEqual`).
- Join: `POST /v1/cell/join` takes `{joinToken, name}` and returns `{cellId, credential}` once. `cells.token_hash` stores the credential hash, and a revoked Cell gets 401.
- Supervisor tokens: only `factory-server admin token create <name>` writes them, through the runtime. No HTTP route creates one. The server must be stopped, since the command takes the writer lock.
- Cell identity comes from its credential. A body `cellId` naming another Cell is 422. `submitCommand` posts to `/v1/cell/jobs/:jobId/commands` and the server takes `orderId` from the job's lease.
- Wire details: an empty claim answers 204, a job answers `{job}`. Blobs move as raw bytes on `PUT` and `GET`. `submitCommand` gains an optional `jobId` that the socket ignores.
- Admin over HTTP: `GET /v1/admin/export` and `POST /v1/admin/rebuild-projections` only. Import and backup stay with `factory-server admin` on the host.
- Listener: `FACTORY_REMOTE=1` adds a TCP listener beside the socket; `FACTORY_BIND` (default `127.0.0.1:7878`) needs it. Bun idle timeout is 255 s for the 25 s claim long-poll and SSE.
- Keepalive: the SSE stream sends a `: keepalive` comment after 15 s of a quiet feed, well under the idle timeout. The socket shares that stream function, so it gets the same comment.
- Clients: CLI and Cell use `remoteFactoryClient` over `fetch`. Mode comes from `FACTORY_URL` or `factory_url`; tokens come from `FACTORY_TOKEN` or `FACTORY_JOIN_TOKEN` only, never a file key.
- Re-join: a 401 from the Factory makes the Cell stop its jobs, delete its stored credential, and join again as a new Cell with `FACTORY_JOIN_TOKEN`. The old Cell is left for the reaper; its credential is never reused.
- Not done: `board?all=1`.
