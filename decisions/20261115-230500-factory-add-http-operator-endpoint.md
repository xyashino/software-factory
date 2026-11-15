---
scope: factory
summary: Operator endpoint moves from a unix socket to localhost HTTP
why: Socket path limit, chmod 0600 and Windows gaps; HTTP needs none of them
date: 2026-11-15
tags: [operator, http, cell, cli, transport]
---

- The Cell serves each Cycle's Operator verbs on `http://127.0.0.1:<port>` (port `0`, OS-assigned), not on `op.sock`.
  - `factory-operator` reads `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN`, and sends `POST` JSON with `fetch`.
  - `FACTORY_OPERATOR_SOCKET` is gone. No socket file is created, so there is no `unlink`, `chmod 0600` or umask step.
- `MAX_SOCKET_PATH` and the socket-length comment in `cycleDirName` are removed. Cycle and Mechanic scratch dirs keep their names.
- The token is checked first, in constant time, from `Authorization: Bearer` or the body `token`. A wrong or missing token gets `401` and never reaches a verb.
  - The body contract `operatorRequestSchema` is unchanged.
- Status codes: `200` accepted, `400` invalid, `401` unauthorized, `405` non-POST, `409` domain refusal, `413` body over 1 MiB, `500` internal.
- Trade-off: the loopback port is reachable by any local process, so the Cycle token is the only gate.
  - The socket was `0600`, so other accounts could not reach it. HTTP drops that protection.
  - Accepted: the token is 24 random bytes, and the endpoint lives only as long as its Cycle.
- Windows is not verified here (Linux only). The transport no longer depends on unix sockets.
