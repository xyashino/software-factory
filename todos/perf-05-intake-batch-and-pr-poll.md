---
status: todo
priority: medium
depends_on: []
line: feature
factory: v2
---

# perf-05: Batch git/gh calls and skip idle writes in intake and PR polling

## Objective

Remove per-file `git cat-file` process spawning, redundant SQLite `intake` upserts on idle polls, and sequential `gh pr view` CLI calls in `intake` and `pr-poll`.

## Read first

- `apps/server/src/adapters/git-mirror.ts`, `pr-state.ts`
- `packages/factory-runtime/src/intake.ts`, `pr-poll.ts`, `ports.ts`
- `packages/factory-core/src/ports/git-mirror.ts`, `pr-state.ts`
- `packages/factory-db/src/intake-table.ts`

## Deliverables

1. **Batched todo reading & idle-poll fast path (`git-mirror.ts` + `intake.ts`):**
   - Replace per-file `git cat-file blob` process spawns in `apps/server/src/adapters/git-mirror.ts` (`todoFiles`) with a single `git cat-file --batch` invocation over stdin for all `todos/*.md` paths.
   - Track the last synced commit / `todos/` tree SHA (and loaded definitions hash) in `syncProject` (`packages/factory-runtime/src/intake.ts`), and skip `ports.intake.upsert(...)` writes for unchanged/done rows when `seenCommit` and `contentHash` have not changed.
2. **Batched / concurrent PR state polling (`pr-poll.ts` + `pr-state.ts`):**
   - Update `pollPrStates` (`packages/factory-runtime/src/pr-poll.ts`) and `ghPrState` (`apps/server/src/adapters/pr-state.ts`) to query open PR states per repository via a single `gh pr list --state all --json url,state` (or bounded concurrent lookups for cross-repo URLs) instead of sequential `gh pr view` per PR.
   - Make `prPollMs` and `intakePollMs` easily tunable via runtime config without changing defaults destructively unless verified by tests.
3. **Tests:**
   - Update/add tests in `packages/factory-runtime/src/__tests__/intake-sync.test.ts` and `apps/server/src/__tests__/` covering batched `cat-file`, unchanged-row skip, and batched/concurrent PR state checks.

## Acceptance criteria

- [ ] `gitMirror.todoFiles` reads all todo blobs in a single `git cat-file --batch` process.
- [ ] `syncProject` performs zero SQLite `intake.upsert` writes when todos and diagnostics are unchanged from the stored `intake` row.
- [ ] `pollPrStates` no longer spawns sequential `gh pr view` processes one PR at a time.
- [ ] `pnpm ci:verify` passes.
