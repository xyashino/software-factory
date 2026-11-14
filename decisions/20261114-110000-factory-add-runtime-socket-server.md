---
scope: factory
summary: Single writer runtime behind a Unix socket server
why: One process owns the database; the runtime takes only ports, so its tests run in memory.
date: 2026-11-14
---

- Writer lock: `acquireWriter(dataDir)` takes an exclusive `flock` on `factory.lock` via `bun:ffi` libc, non-blocking.
  - A second process is refused at once with `WriterHeldError`.
  - The kernel releases the lock on exit or crash, so no pid file is kept.
- Runtime: `factory-runtime` is transport-free and opens nothing. `createRuntime` takes ports only; `openRuntime(dataDir)` composes the SQLite adapters and needs the writer lock before it opens the database.
- Statement gate: lease, signal, worker, blob and projection statements queue behind the write mutex. Inside a transaction body they run at once, detected with `AsyncLocalStorage`, so a foreign statement never joins an open `BEGIN IMMEDIATE`.
- Command loop: load, fold, decide, `andon_raised` when `nextJob` asks, project, append. A replayed `commandId` returns its stored response before `decide`, because a replay can be undecidable on the new state.
- Continuation and claim: the lease and the signals are written in the same transaction as the events.
  - A job-ending Worker command claims the same order's next job when this Worker can run it.
  - The claim is tried on a copy, so a job that cannot be built leaves the command's own events alone.
- Contracts: `factory-core/src/contracts/` holds the zod payloads and one route table. Every route is `POST /v1/<path>`, and the socket client and the in-process client share one validate-call-validate path.
- Transport: the socket is the only listener (mode 0600, umask tightened around the bind). Worker commands that an Operator sends carry the Operator actor and its Cycle id, because `decide` requires it.
- Naming: code says `worker` (`workerId`, `holder: 'worker'`); docs say `cell`. Code wins until a rename, noted here.
- Limits: the Line operator pool is read from the loaded definitions, since the pinned snapshot does not carry it.
  - Intake (`CreateOrder` from git) is v2-10.
  - Tests seed orders through the command loop, and the `projects` row is seeded by `seedProject`.
