---
scope: factory
summary: Cell operator endpoint is localhost HTTP, not a unix socket
why: Unix socket paths have a length cap and need chmod; localhost HTTP has neither and runs on Windows
date: 2026-11-15
tags: [operator, cell, http, socket, windows, cycle-token]
---

- The Cell serves each Cycle's Operator verbs on `http://127.0.0.1:<port>`, port `0` (OS-assigned), replacing the per-Cycle `op.sock` unix socket.
  - `factory-operator` reads `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN`, and sends each verb as a `POST` JSON body with `fetch`.
  - `FACTORY_OPERATOR_SOCKET` is gone. `MAX_SOCKET_PATH`, the `0600` mode, the umask dance and the socket-file unlink are removed.
- The token is still required on every request, checked in constant time. It comes from `Authorization: Bearer` or the body's `token`.
- Trust boundary changes: a unix socket was reachable only by the owning account, but any local process can reach a loopback port.
  - The Cycle token is now the only gate between a local process and the verbs. It is 192 bits, fresh per Cycle, and never logged.
  - The endpoint binds `127.0.0.1` only, so no remote host can reach it.
- `cycleDirName` keeps its 12-character digest name. The length comment is dropped, the name is unchanged.
- Windows: the transport needs no platform code. It is verified on Linux only.
