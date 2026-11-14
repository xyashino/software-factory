---
scope: factory/cli
summary: Supervisor CLI as socket client with one-shot fallback
why: The CLI must not import the runtime, yet one-shot writes need the writer lock and the same command loop.
date: 2026-11-14
tags: [v2, cli, socket, factory-server, writer-lock]
---

- **Socket adapter lives in apps/cli.** `apps/cli/src/client/socket.ts` carries the shared route table over `factory.sock`.
  - It copies the server's client, since STRUCTURE §3 forbids app-to-app imports.
  - A dead socket throws `SocketUnreachable`; a server error throws `WireFailure`, which is never retried as a one-shot.
- **One-shot is a subprocess.** `apps/cli/src/client/once.ts` runs `factory-server --once --data-dir <dir>` with `{route, request}` on stdin.
  - Exit codes: 0 ok, 1 failed, 2 refused, 3 writer held.
  - The CLI never opens the database; the lock is released when the subprocess exits.
- **Writer held means a server is starting.** The transport retries the socket and the one-shot for about three seconds, then reports `unavailable`.
- **One commandId per invocation.** `newCommandId` makes a ULID before the first call; socket retries send the same body, so a replay returns the stored response.
- **New routes, same table.** `supervisor/events` is a long-poll (≤ 25 s) over `feed`, the local form of `/v1/stream`.
  - Join-token create, list and revoke use the existing `join_tokens` table through a new `JoinTokenStore` port.
  - `supervisor/admin/export` returns the archive base64 in JSON.
- **Export is refused when a blob is missing.** A Line hash is a `sha256:` token, so the snapshot blob is stored as canonical JSON under that ref, which keeps every cited blob present.
- **Intake sync is a route, not yet an intake.** `factory sync` calls `supervisor/intake/sync`; with no `IntakeRunner` wired (v2-10) it refuses with `precondition` and changes nothing.
  - Once v2-10 wires a runner, the same route answers `{ created }` with no CLI change.
- **Join-token create is replay-safe.** Its request carries a `commandId`; a join token row stores it under a unique index (migration 0002).
  - A replayed create is refused as `precondition` instead of making a second token. The plain token is not stored, so it cannot be returned again.
- **Config is a JSON file, not a database.** Precedence: flag, `FACTORY_DATA_DIR`, `dataDir` in the file, then `~/.local/share/factory`.
  - Colour is off with `--no-color`, a non-empty `NO_COLOR`, or `"color": false`.
- **Render layer.** `apps/cli/src/render/` holds the `Paint` interface with a plain and a coloured implementation (picocolors).
  - Colour applies to views only; stored events and `--json` output stay plain.
- **Boundaries enforced.** ESLint bans `factory-runtime` and `factory-server` imports in `apps/cli`.
  - A process test checks that no command holds a TCP listener.
