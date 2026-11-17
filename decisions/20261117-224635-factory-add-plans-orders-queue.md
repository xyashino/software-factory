---
scope: factory/orders
summary: Add order plans, work orders and markdown queue API
why: Tasks enter as todos/<slug>.md; the server must validate single-parent stacks, pick base branches and round-trip the queue without drift.
date: 2026-11-17
tags: [factory-server, queue, topology]
---

- `resolveBaseBranch` is pure and covers the 5 `PLAN.md` 6.1 scenarios: plan init, standalone, standalone chained, plan root, plan step.
- `todos/<slug>.md` parser and formatter, format and parse round-trip.
  - Frontmatter: `status` (`queued | paused | cancelled`), `priority`, `line`, `plan`, `depends_on`, `type`.
  - `depends_on` takes one parent, as a string or a one-element list.
  - Body: `# <slug>: <title>`, then the description.
- Queue import: all files parsed first. Any parse, duplicate, unknown-parent or cycle error returns 422 and writes nothing. `dry_run` runs the same path in a transaction that is rolled back.
- Queue import `apply` is idempotent per `commandId`. The stored counts come back on replay.
- Existing orders in `waiting_parent | queued | paused | line_unavailable` take structural edits. Orders in `running | delivering | delivered | completed | blocked` only take priority or cancel.
- Queue export renders the same markdown the importer reads, so export then import leaves the queue unchanged.
- Order plans: create (optionally straight to `branching`), list, get, transition. Activation enqueues a `plan_branch` job.
- Work orders: create, list, get with steps, jobs and incidents, transition. Completing a parent releases its `waiting_parent` children.
- Queue actions (`pause`, `unpause`, `reset_to_scratch`, `cancel`, `reprioritise`) run over a batch in one transaction. An invalid transition fails the whole batch with 409.
- State changes write `state_transitions` rows. Command ids live on the first row of an apply. Ids are `<projectId>:<slug>`. No migration.
