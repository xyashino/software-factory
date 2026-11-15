---
status: todo
priority: medium
depends_on: []
line: feature
factory: v2
---

# perf-04: Eliminate O(N^2) queue scans, SQLite read lock contention, and claim thundering herd

## Objective

Reduce CPU overhead, SQLite lock contention, and redundant queries in `factory-core`, `factory-db`, `factory-runtime`, `apps/server`, and `apps/cell` during queue selection, command handling, HTTP auth, and multi-slot claiming.

## Read first

- `packages/factory-core/src/queue/deps.ts`, `select.ts`
- `packages/factory-runtime/src/queue.ts`, `claim.ts`, `command-handler.ts`, `notifier.ts`
- `packages/factory-db/src/sqlite-event-store.ts`, `sqlite-blob-store.ts`, `projects-table.ts`, `write-mutex.ts`
- `apps/server/src/http/app.ts`
- `apps/cell/src/loops/claim.ts`, `apps/cell/src/cell.ts`
- `docs/RULES.md`, `docs/STORAGE.md`

## Deliverables

1. **O(N) dependency resolution & single-read `claim`/`continuation`:**
   - Refactor `resolveDeps` (or add a pre-indexed helper) in `packages/factory-core/src/queue/deps.ts` so `readQueue` builds the `Map<OrderId, DepRow>` once per pass instead of rebuilding it inside the loop for every order.
   - Pass already-fetched `rows` and `projects` from `readQueue` through `command-handler.ts` (`ClaimJob` and `continuation` / `cellCanRun`) into `buildJob` instead of re-reading and re-parsing all `orders` and `projects` 2–3 times per command.
2. **Unblock SQLite WAL reads from `writeMutex` (`packages/factory-db`):**
   - Separate read-only queries (`load`, `loadPlan`, `response`, `feed`, `projections.orders()`, `projections.plans()`, `projects.list()`, `blobs.get/stat`) from `writeMutex` (or use a dedicated read-only WAL connection on the same DB file) while keeping `writeMutex` + `BEGIN IMMEDIATE` strictly for writes and transactions.
   - Maintain full zod read validation (`RULES.md §2.3`) and synchronous projection consistency inside transactions.
3. **Server auth cache & coordinated Cell claimer:**
   - In `apps/server/src/http/app.ts` (or `remote.ts`), cache verified `tokenHash -> caller` in memory with immediate invalidation on `revokeCell` / `revokeJoinToken` to avoid hashing + SQLite lookup on every `heartbeat`, `claim`, and `submitCommand`.
   - In `apps/cell/src/loops/claim.ts` & `cell.ts`, coordinate multi-slot Cells through a single shared claimer/gate (claiming only while free slots exist instead of running `N` parallel long-polls that all wake and contend on `claimOnce` simultaneously).
4. **Tests:**
   - Verify all `factory-core`, `factory-db` contract/mutex, `factory-runtime`, `apps/server`, and `apps/cell` tests pass.

## Acceptance criteria

- [ ] `readQueue` builds the order lookup map once (`O(N)` instead of `O(N^2)`) and `command-handler.ts` avoids duplicate `orders()`/`projects.list()` loads per `ClaimJob` / continuation.
- [ ] Read-only SQLite queries are not serialized behind `writeMutex` / long `blob.sweep` or write transactions.
- [ ] Multi-slot Cells issue at most one active `claim` long-poll at a time and server HTTP auth caches valid credentials with revocation invalidation.
- [ ] `pnpm ci:verify` passes.
