---
scope: factory
summary: Operator endpoint moves from unix socket to localhost HTTP
why: Socket paths hit OS length limits; loopback HTTP works on every OS
date: 2026-11-15
tags: [operator, cell, http, transport, windows]
---

- The Cell serves each Cycle's Operator verbs on `http://127.0.0.1:<port>`, an ephemeral port from `listen(0)`, replacing the per-Cycle `op.sock` unix socket.
- `factory-operator` reads `FACTORY_OPERATOR_URL` (was `FACTORY_OPERATOR_SOCKET`) and posts one JSON verb per request with `fetch`. `FACTORY_CYCLE_TOKEN` is unchanged.
- Token: `Authorization: Bearer` header, else the body's `token`; compared in constant time. Missing or wrong gives `401`.
- Removed: `MAX_SOCKET_PATH`, the `0600` file mode, the umask dance, `chmod` and `unlinkSync` of a socket file. The Cycle directory name no longer has to stay short.
- Status: `200` ok, `400` invalid, `401` unauthorized, `409` refusal, `500` internal, `405` non-POST, `413` body over 1 MiB.
- Trade-off: any local account can reach the port, so the token is the only gate. The unix socket was `0600`. Accepted for portability; the token still gates every verb.
