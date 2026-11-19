---
scope: factory
summary: Add HTTP server client and factory server start, stop, token create
why: Every supervisor command needs one HTTP client, and the CLI must start and stop the server without touching Cells.
date: 2026-11-18
tags: [factory, cli, server, http]
---

- `ServerPort` now takes a bearer string and gains `probe()`: any HTTP answer to base URL counts as up.
- HTTP client (`adapters/http/server-client.ts`): one `fetch` per call, 10 s timeout, no retry. Network failure or timeout throws `Unreachable` (exit 3).
- Reply mapping (`adapters/http/map-reply.ts`): 200 and 201 return the body. Other statuses throw `Refused` with `code: message` from the body (exit 1). Unreadable body throws `Unreachable`.
- `TokenStorePort.write` takes the raw token string. Token file lives at `FACTORY_TOKEN` (read first) or `~/.config/factory/token`, written `0600`.
- `factory server start` spawns `bun apps/factory-server/src/index.ts` detached, logs to `$FACTORY_DATA_DIR/server.log`, writes `server.pid` `0600`.
  - Waits up to 10 s for base URL. Live pid refuses with `server already running` (exit 1).
  - Timeout kills the child and exits 3.
- `factory server stop` sends `SIGTERM` to the pid in `server.pid` only, waits up to 10 s, removes the pid file. No pid or dead pid prints `server not running` (exit 0). It never calls `/api/v1/cells/*`.
- `factory server token create` runs the server's `admin token create` with the same `FACTORY_DB_PATH`. Prints the token once. `--save` writes the token file and prints nothing.
- Server procedures run without a stored token (`runWithoutToken`) because they act on the local machine, not through a route.
- `ProcessPort` gains env, `spawnDetached`, `isAlive`, `terminate`. `ClockPort` gains `sleep`. `Ports` gains `pidFile`.
- `turbo.json` declares `FACTORY_URL` as a global env var.
