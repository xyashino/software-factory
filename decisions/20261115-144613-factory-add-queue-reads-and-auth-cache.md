---
scope: factory/perf
summary: Queue reads O(N), SQLite reads off the writer, cached auth
why: Queue pass was O(N^2), reads queued behind writes, and every request re-checked its credential
date: 2026-11-15
tags: [v2, perf, runtime, db, server]
---

- `resolveDeps` takes a pre-built `indexDeps` index; `readQueue` builds it once per pass, and counts running work per project in one pass.
- `readQueue` is split into `loadQueueSnapshot` + `queueOf`, so a command loads each projection at most once per attempt.
- A continuation reads the orders and the registry once (it read them twice before); a claim still reads them twice, once to choose and once to build.
- SQLite reads outside a transaction run on a read-only WAL connection (`openReadDatabase`) with no write mutex; writes and transactions keep the mutex and `BEGIN IMMEDIATE`. `:memory:` keeps the mutex fallback.
- Reads inside a transaction use the writer, so they see their own writes. STORAGE §3.1 documents the committed-only rule for outside reads.
- The server caches positive credential checks by token digest, never raw tokens and never refusals, for at most 30 s.
- Revokes emit through the runtime (socket and HTTP alike), and the server cache drops the revoked Cell's entries at once.
