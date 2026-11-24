---
scope: factory/hq
summary: Add actor_label to state transitions from the token name
why: Supervisors need to audit which named token triggered each transition, without ever storing the token secret or hash
date: 2026-11-24
---

- `state_transitions` gets a nullable `actor_label` column (SQLite migration `0007_transition_actor_label`, Postgres `0001_transition_actor_label`). Existing rows stay `NULL`.
- `Principal` carries `name` from `safe_tokens.name`. The safe-token auth adapter fills it; test grants use `test-token`.
- `flushTransitions(tx, log, { actorLabel, command? })` stamps the caller's token name on every transition whose `actorKind` is not `system`. System transitions (lease reaper, gone-cell) stay `NULL`.
- Every procedure that flushes a log passes `ctx.principal.name`: queue import and actions, work orders, order plans, incidents, cell claim and heartbeat, cell gone, job transitions.
- `transitionDto` and the `/api/v1/stream` payload carry `actorLabel: string | null`. The sf watch client parses the same DTO.
- Label is the token's human name, never its secret or hash. A black-box test mints a supervisor token, imports the queue, and checks the streamed transition has `actorLabel: "admin"` with no token or hash in the event data.
- Not in this change: a label on the `Actor` type or on cell-level identity. The label is per caller token, not per cell or mechanic.
- Spec paths `apps/hq/drizzle/` do not exist; the migrations live in `apps/hq/src/db/migrations/`.
