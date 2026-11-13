---
status: todo
priority: medium
depends_on: [v2-14-clis]
workflow: feature
---

# v2-18: Optional remote mode — TCP HTTP/SSE listener on the same server, remote Workers, remote CLI

## Objective

Expose the same `factory-server` to other machines as an **optional** TCP listener, next to the Unix
socket. It serves HTTP with SSE and reuses the contracts already used by the socket. Add the Hono HTTP
transport, authentication, the remote Worker join and API, the SSE event stream and remote admin
entrypoints, plus the remote `FactoryClient`. Nothing in local mode changes: the socket stays the local
transport, and WebSocket is not used in v2.0. This todo is started only after the local core
(v2-09 to v2-14) is complete and proven.

## Read first

- `docs/PROTOCOL.md` §1 (credentials), §2 (remote transport), §3.1–3.2 (HTTP routes), §3.5 (errors)
- `docs/PLAN.md` trust boundaries, F2–F5 (distributed flows)
- `docs/STRUCTURE.md` §1–3 (`apps/server`, `apps/worker` remote client), `docs/RULES.md` §3.6, §4.7

## Scope (ROADMAP items)

`factory-m4-http`, `factory-m4-stream`, the remote part of `factory-m4-admin`, the remote adapter of
`factory-m5-client-loops`, and the remote adapter of `factory-m6-cli`. Remote e2e with
`factory-m4-e2e-fake-worker`.

## Deliverables

1. `apps/server` (`factory-server`): a TCP listener beside the Unix socket, a Hono app over the same
   runtime that reuses the socket's zod contracts; error mapping of PROTOCOL §3.5; binds `127.0.0.1` by
   default, `FACTORY_BIND` to override. No command or scheduling logic of its own.
2. Auth middleware: supervisor tokens, join tokens and Worker credentials (hashes only). The socket keeps
   OS-account trust and does not use these tokens.
   `factory-server admin token create <name>` writes through the runtime; there is no network path that
   creates a supervisor token.
3. Supervisor routes (PROTOCOL §3.1) and Worker routes (PROTOCOL §3.2): `join`, `hello`, `claim`
   (long-poll ≤ 25 s), `heartbeat` (per-job `ok | stale`, signals, acks), blob GET/PUT,
   `jobs/:jobId/commands`.
4. `/v1/stream` SSE adapter over the runtime event feed with `Last-Event-ID` = `globalSeq`.
5. Remote `FactoryClient` (CLI) and remote Worker client: typed HTTP client from the shared contracts;
   remote 401 → re-join; mode selected by config, socket remains the default.
6. Remote admin entrypoints: `factory-server admin backup | export | import | rebuild-projections`,
   running against the remote runtime's own database.
7. Remote e2e: the same fixture scenario as v2-10, driven through TCP HTTP with a fake Worker, asserting
   the same events and projections as local mode.

## Acceptance criteria

- Each remote endpoint and error mapping has an HTTP test against the same runtime composition.
- Local and remote runs of the same scenario produce equivalent events and projections.
- Duplicate `commandId` over HTTP returns the stored response including `next`; stale epoch → 409.
- Switching to remote mode never implicitly copies or synchronizes local data.
- Local mode still starts no TCP listener (test); the Unix socket behaves as in v2-09.
- `pnpm turbo check-types lint test` green.
