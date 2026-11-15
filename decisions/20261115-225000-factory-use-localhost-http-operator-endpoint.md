---
scope: factory
summary: Operator verbs travel over localhost HTTP, not a unix socket
why: Unix socket paths hit an OS length limit, need chmod 0600 and fail on Windows; loopback HTTP has none of these
date: 2026-11-15
tags: [v2, operator, cell, http, transport]
---

- Transport: each Cycle's Cell starts `node:http` on `127.0.0.1`, port `0`, and passes `FACTORY_OPERATOR_URL=http://127.0.0.1:<port>` with `FACTORY_CYCLE_TOKEN`. `factory-operator` sends one `POST` per verb with `fetch`.
- Removed: `op.sock`, `MAX_SOCKET_PATH`, the `0600` mode, the umask dance, `chmod` and `unlinkSync`. Nothing is written to disk for the endpoint.
- Token: `Authorization: Bearer` header first, body `token` field second. The comparison stays constant time (`timingSafeEqual`, equal-length buffers). A bad token gets `401` before the verb schema runs.
- Statuses: `200`, `400` (not JSON or schema), `401`, `405` (not POST), `409` (refused verb), `413` (body over 1 MiB), `500` (dispatcher threw). Replies stay `OperatorReply` JSON.
- Trust: any local process can reach the loopback port.
  - The Cycle token is the only gate. A Unix socket with mode `0600` kept other accounts out; this does not.
  - Accepted trade-off on a single-user host; revisit before any multi-user deployment.
- Not verified on Windows here; the change removes the reason the socket could not run there.
- Proxy: Bun's `fetch` honours `HTTP_PROXY`. A proxied environment needs `NO_PROXY` covering `127.0.0.1`.
