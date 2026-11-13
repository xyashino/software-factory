---
status: todo
priority: high
depends_on: [v2-02-core-events-state]
workflow: feature
---

# v2-06: Queue selection and dependency overlay

## Objective

Implement `selectClaimable` and the dependency overlay, pure, in `factory-core/src/queue/`.

## Read first

- `docs/CORE.md` §8 (claimable rule, ordering keys, dependency policy), §4.2 (board statuses)
- `docs/STORAGE.md` §4 ("Dependencies are an overlay")

## Scope (ROADMAP items)

`factory-m2-queue`.

## Deliverables

1. `QueueEntry`, `WorkerView`, `Limits` types.
2. `selectClaimable(queue, worker, limits)`: the claimable rule (holder, next, deps, project, runner,
   capabilities, `avoidWorkers` cooldown, per-project limit) and the five ordering keys with a total,
   deterministic order.
3. `resolveDeps(entry, others, depPolicy)` → `satisfied | waiting | broken`, covering: delivered,
   merged policy, missing dependency (satisfied), cancelled (broken), closed-unmerged under
   `merged` (broken). Board status overlay `waiting_deps` / `deps_broken`.

## Acceptance criteria

- A test per claimable condition and per ordering key, including ties down to `orderId`.
- A test per dependency outcome.
- `pnpm turbo check-types lint test` green.
