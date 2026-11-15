---
scope: factory
summary: Operator talks to Cell over localhost HTTP
why: Unix socket path limits, 0600 chmod, and no Windows support
date: 2026-11-15
tags: [http, operator, cell, transport]
---

- `factory-operator` reaches its Cell through `FACTORY_OPERATOR_URL` (`http://127.0.0.1:<port>`) instead of a per-Cycle unix socket `op.sock`.
- The Cell binds `node:http` to `127.0.0.1` on port `0`, so the OS picks a free port; one endpoint per Cycle, closed when the Cycle ends.
- Removed: `MAX_SOCKET_PATH`, the socket-path length check, `OPERATOR_SOCKET_MODE` (0600), the umask dance, `chmod`, and `unlinkSync` of a stale socket file. Nothing is written to disk.
- `FACTORY_OPERATOR_SOCKET` is replaced by `FACTORY_OPERATOR_URL`. `FACTORY_CYCLE_TOKEN` is unchanged.
- Auth: `Authorization: Bearer <token>` header, or the body `token` field; the header wins when both are sent. Comparison stays constant-time (`timingSafeEqual`), checked before the verb schema.
- Status codes: 200 answered, 400 invalid, 401 unauthorized, 405 non-POST, 413 body over 1 MiB, 500 internal.
- `operatorRequestSchema` and `OperatorReply` are unchanged; the wire shape is the same JSON.
- The CLI uses `fetch` to the URL; no `node:net` in `apps/operator-cli`.
- Trade-off: any local process can reach `127.0.0.1:<port>`. The socket was reachable by the owning account only (0600); the Cycle token is now the sole gate. Accepted for portability.
- Windows: no code path needed, but not verified on Windows in this change; verified on Linux only.
