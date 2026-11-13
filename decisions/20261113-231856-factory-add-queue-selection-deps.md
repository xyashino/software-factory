---
scope: factory/core
summary: Add queue selection and dependency overlay as pure functions
why: CORE 8 claimable rule, ordering keys and dependency outcomes need a tested pure home before the queue read path
date: 2026-11-13
tags: [v2, core, queue, deps, factory]
---

- `src/queue/` (no barrel): `types.ts` holds `QueueEntry`, `WorkerView`, `Limits` as CORE 8 writes them
- `selectClaimable(queue, worker, limits)` returns a new sorted array; the input is not mutated
  - claimable: holder queue, next job, deps satisfied, project served, runner and capabilities held, no active cooldown, project under its limit, free slot
  - ordering: priority, resumed, progressed, same Worker as last, createdAt, orderId (total, string compare)
  - `isClaimable` and `compareEntries` stay private; tests go through `selectClaimable`
- `resolveDeps(entry, others, depPolicy)` folds per dependency: missing row satisfied, cancelled broken, merged satisfied, delivered satisfied under `delivered`, under `merged` waiting or broken when PR closed
- `boardStatusWithDeps` overlays `waiting_deps` / `deps_broken` only on queued + next job; `OverlayStatus` lives in `deps.ts`, `BoardStatus` unchanged
- `DepPolicy` added in `deps.ts`; no existing type renamed
- CORE 8 reopened-dependency rule is not special-cased: `resolveDeps` reads the rows as given
- Tests: 68 unit tests in `src/queue/__tests__/` (claimable per condition, each ordering key, precedence, ties, permutations, dependency outcomes, overlay)
