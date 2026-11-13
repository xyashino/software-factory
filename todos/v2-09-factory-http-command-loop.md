---
status: todo
priority: high
depends_on:
  [v2-05-definitions, v2-06-queue-selection, v2-08-storage-leases-blobs-export]
workflow: feature
---

# v2-09: Factory server core — runtime, single writer, Unix socket, command loop, claims

## Objective

Build the core of v2: the `factory-runtime` application layer, composed and run by `apps/server`
(`factory-server`). It owns the single-writer lock, the command loop, the claim/lease/reaper lifecycle
and prompt rendering. It also exposes those operations on a Unix socket in the data directory
(`$FACTORY_DATA_DIR/factory.sock`, mode 0600), which the CLI and Workers use as clients. No TCP or HTTP
is part of this todo; the optional remote listener is `v2-18`.

## Read first

- `docs/PROTOCOL.md` §1, §2, §4–7 (`Job`, leases, idempotency, signals, local transport)
- `docs/STORAGE.md` §1 (single writer), §3 (continuation inside one transaction)
- `docs/CORE.md` §1 (the write loop), §6, §7
- `docs/STRUCTURE.md` §1–4 (`apps/server`, `factory-runtime`, dependency rules), `docs/RULES.md` §2.6, §3, §4.1
- v1: `packages/software-factory/src/prompts/*`

## Scope (ROADMAP items)

`factory-m4-runtime`, `factory-m4-claim-reaper`, `factory-m4-prompts`, `factory-m4-socket`.

## Deliverables

1. `factory-db` writer lock: `acquireWriter(dataDir)` takes an exclusive `flock` on `factory.lock`,
   fails immediately if another process holds it, and releases on process exit (STORAGE §1).
2. `factory-runtime`: composition root that receives `EventStore`, `BlobStore`, `LeaseStore`, clock and
   ids through ports, and requires a held writer lock for any write. It exposes transport-neutral
   Supervisor and Worker operations. It contains no HTTP code.
3. Runtime command handler: load → evolve → decide → nextJob → `andon_raised` → project → append;
   conflict retry (3, then 503); per-order in-process serialisation; `dryRun`; continuation claimed
   in the same transaction with `next` stored in the idempotent response.
4. Socket listener in `apps/server`: a Unix socket at `$FACTORY_DATA_DIR/factory.sock` with mode 0600.
   Routes are typed by the shared zod contracts for Supervisor and Worker operations. Trust is the
   operating-system account; no token is needed and no TCP port is opened. Also the socket client
   (`SocketFactoryClient`) that tests use to call the same routes.
5. Claim and lease lifecycle: claim (long-poll ≤ 25 s), heartbeat, signals, reaper (5 s), boot grace,
   Worker revocation expiring its leases. These run inside the server (`factory run`), under the held
   writer lock.
6. Prompt rendering: `CycleContext` + Operator profile + templates → prompt blob; runtime prompts into
   `Job.station.runtimePrompts`; relative paths only.

## Out of scope

HTTP, TCP listeners, remote auth, remote Worker endpoints, SSE, remote admin entrypoints (v2-18). Git
intake and local e2e (v2-10).

## Acceptance criteria

- Writer lock: a second server process gets an immediate refusal while the first holds it; the lock is
  released when the holder exits or crashes (test with two processes).
- Runtime use-case tests run against SQLite in a temp dir; a request over the socket client returns the
  same response as calling the runtime directly.
- Socket test: `factory.sock` is created with mode 0600 and no TCP listener is started.
- Duplicate `commandId` returns the stored response including `next`; stale epoch is rejected; dry run
  appends nothing; expired lease → `cycle_failed{lost}` + `job_lost`.
- Prompt snapshots for each Line Station contain no absolute path.
- A write without the writer lock is rejected by the runtime (test).
- `pnpm turbo check-types lint test` green.
