---
scope: factory
summary: Local server over a Unix socket is the core; remote HTTP is an optional adapter
why: One server process owns the database through the writer lock, so Workers and the CLI never open it. Local clients reach it over a Unix socket with OS-account trust. The remote TCP HTTP/SSE listener is added later on the same server, so local mode does not need a network listener.
date: 2026-11-13
tags: [v2, architecture, local-first, server, transport, unix-socket, single-writer]
---

- **The server is the core.** `apps/server` (`factory-server`) is the one core process. It owns the SQLite database through the writer lock (STORAGE §1) and runs intake, scheduling, the reaper and leases through `factory-runtime`. `factory run` is the local start command for the same server. Workers and the CLI never open the database.
- **Local transport is a Unix socket.** The server listens on `$FACTORY_DATA_DIR/factory.sock` with mode 0600. Trust is the operating-system account. Clients use the shared zod contracts over the socket; Bun's `fetch` supports a `unix` option for this. A Unix socket is local IPC, not a network listener.
- **Remote transport is optional (M4R, todo v2-18).** The same server additionally binds TCP with HTTP/SSE and the auth rules in PROTOCOL §1. WebSocket is not used in v2.0. There is no connection pool and no multiplexing protocol.
- **One-shot fallback.** `FactoryClient` (in-process adapter) is no longer the default path. Default: the CLI and Workers are clients of the running server over the socket. If no server is running, a CLI write may start the runtime in-process for that one command while holding the writer lock.
- **Writes while the server runs.** A CLI write while the server runs is not refused; it goes through the socket to the running server. This flips the earlier rule that refused it (OPEN-QUESTIONS Q19).
- **Network applies only to remote mode.** Local mode uses the socket and no network (OPEN-QUESTIONS Q11).
- **Workers are socket clients.** By default one Worker process runs N slots, where a slot is one concurrent job. Several Worker processes are allowed for isolation (crash isolation, different machines or users). Local Workers are not in-process with the runtime (OPEN-QUESTIONS Q21).
- **Naming.** The process is `factory-server` everywhere. Local mode runs it on the socket; remote mode adds TCP.
- **Kept.** Single writer per database; claims are atomic in the server; leases, epochs and self-fence are unchanged; Cells (Workers) never touch the database; `factory-operator` talks only to its Worker's per-Worker socket, which is separate from the server socket.
- **Authorization.** Local mode follows the operating-system account and needs no supervisor token. Remote mode uses supervisor, join and Worker credentials.
- **No state sharing between modes.** Local and remote databases are separate sources of truth. Switching modes does not synchronize or copy state.
- **Config file, not a second database.** Mode, remote endpoint, credentials and local data path live in a config file. Absent configuration, `factory` uses the local database.
- **Supersedes the earlier in-process local decision.** The earlier record that ran local Workers in-process with the runtime, and used an in-process `LocalFactoryClient`, is replaced by this one.
- **Updated documents:** `docs/PLAN.md`, `docs/PROTOCOL.md`, `docs/STORAGE.md`, `docs/STRUCTURE.md`, `docs/RULES.md`, `docs/ROADMAP.md`, `docs/OPEN-QUESTIONS.md`, `docs/README.md`, and the todos v2-09, v2-10, v2-11, v2-12, v2-14, v2-15 and v2-18.
