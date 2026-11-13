---
status: todo
priority: high
depends_on: [v2-10-factory-intake-stream-admin-e2e]
workflow: feature
---

# v2-14: CLI — `factory` supervisor commands over the socket

## Objective

Implement `factory`, the Supervisor's command line, as a client of the running `factory-server` over the
Unix socket, with a one-shot fallback when no server runs. This todo comes **before the Worker**
(v2-11), so the Supervisor can drive and inspect the server from a real command line while the Worker is
built. `factory-operator` is not here; it moves to v2-12 with the Operator socket it talks to. The CLI
needs no network listener. The remote TCP adapter is added in `v2-18`.

## Read first

- `docs/PROTOCOL.md` §2–3, §10, `docs/STRUCTURE.md` §1–3 (`apps/cli`, client adapters, `factory-server`)
- v1: `packages/software-factory/src/cli/*`, `src/supervisor/console-lines.ts`, `src/paint.ts`
  (rendering ideas only; not carried over)

## Scope (ROADMAP items)

`factory-m6-cli`.

## Deliverables

1. `apps/cli`: every command of PROTOCOL §10 through the `FactoryClient` interface, bound to the socket
   adapter. Cover status `--watch` (server event feed), show, log `-f`, answer, resume, reopen, nudge,
   cancel, prio, sync, workers, check and admin export. Keep one ULID `commandId` per invocation and
   reuse it on retries. `factory check` remains offline via `factory-definitions`.
2. Writes go through the socket to the running server. A CLI write while the server runs is not refused
   (OPEN-QUESTIONS Q19). If no server runs, a one-shot write starts `factory-server --once` as a
   subprocess that takes the writer lock (`factory-db`, STORAGE §1), runs that command, and exits. The CLI
   itself never imports the runtime library (STRUCTURE §3). Reads are always allowed.
3. Config file for the local data directory and settings. No second SQLite database for settings.
   Remote mode configuration is added in `v2-18`.
4. `factory run` starts `factory-server` as a long-running process: it owns the database under the writer
   lock, runs intake, scheduling and the reaper, and serves the Unix socket. It binds no network port.
5. Colour rendering in `apps/cli/src/render/` with `picocolors` (catalog version, already a dependency of
   `apps/cli`), ported from v1 `src/paint.ts`:
   - a `Paint` interface (`bold`, `dim`, `red`, `green`, `yellow`, `cyan`, `blue`, `gray`, `magenta`) with a
     plain implementation for tests and a coloured one by default; `NO_COLOR` turns colour off;
   - board: colour per board status (`running`, `waiting_answer`, `andon`, `delivering`, `delivered`,
     `merged`, `cancelled`, `deps_broken`, `waiting_deps`, `queued`) and per holder;
   - `factory log` / Traveler (`log-view`): colour per event family (lifecycle, Cycle, Andon, question,
     delivery), with timestamps dimmed and ids shown short;
   - colour is applied only at the presentation layer. Stored events, blobs and `--json` output are never
     coloured (RULES §2.2: stored content stays plain).

## Acceptance criteria

- Every `factory` command is tested against a running server on a temp socket.
- The one-shot fallback is tested where no server runs, and the subprocess exits after the command.
- A second server is refused while one holds the writer lock; reads still succeed (test).
- No network listener is started by any command (test).
- `apps/cli` does not import `factory-runtime` (lint).
- `pnpm turbo check-types lint test` green.
