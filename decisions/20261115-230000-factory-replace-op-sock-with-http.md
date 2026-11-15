---
scope: factory
summary: Operator endpoint moves to localhost HTTP from op.sock
why: Unix socket path limit, 0600 chmod and umask dance block Windows
date: 2026-11-15
tags: [operator, cell, http, transport, windows]
---

- The Cell serves each Cycle's Operator verbs on `http://127.0.0.1:<port>`, port `0` (OS-assigned), instead of a per-Cycle unix socket `op.sock`.
  - `factory-operator` reads `FACTORY_OPERATOR_URL` and sends one `POST` JSON per verb with `fetch`; `FACTORY_CYCLE_TOKEN` is unchanged.
  - Removed: `MAX_SOCKET_PATH`, `OPERATOR_SOCKET_MODE` (0600), the umask dance, `chmod`, `unlinkSync`, and the socket-path length comment on `cycleDirName`.
- Token: `Authorization: Bearer` header, or the body `token` field. Compared in constant time; missing or wrong is `401`. The verb schema is unchanged (`operatorRequestSchema`, strict, token in body).
- Status: `200` ok; `400` invalid body or verb; `405` non-POST; `413` body over 1 MiB; `409` dispatched refusal; `500` dispatcher throw.
- Trust: loopback only, but any local process can connect. The token is the only gate. The old 0600 file mode no longer applies; this ADR accepts that trade for Windows reach and no path limit.
- Node-only transport: `node:http` server in the Cell, global `fetch` in the CLI. No Windows-specific branch; Windows is not verified on this machine.
- `docs/PROTOCOL.md` §3.3 documents the endpoint. The Factory socket (`factory.sock`, PROTOCOL §2) is untouched.
