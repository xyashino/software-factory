---
scope: factory/server
summary: Supervisor SSE stream of state transitions with backlog replay
why: Supervisors need live transitions with no gaps, per PLAN.md 9 row /api/v1/stream.
date: 2026-11-18
tags: [factory, sse, transitions, http]
---

- New `GET /api/v1/stream?projectId=&afterSeq=` (`supervisor:read`): Server-Sent Events, event `transition`, `id` = seq, JSON data.
- Auth and scope run before the stream opens: missing token gives 401, missing scope gives 403, both as JSON.
- `afterSeq` (default 0) replays `state_transitions` with `seq > afterSeq` in seq order. `projectId` filters backlog and live events.
- Subscribes to `transitionBus` before reading the backlog, so no commit falls between them. Live events with `seq` at or below the last sent seq are dropped.
- Writes go through one ordered queue. `: keepalive` comment every 15 s.
- Client abort unsubscribes from the bus and clears the keepalive timer.
- `authorize` exported from `application/core/procedure.ts`. `createTestApp` accepts or returns `transitionBus`.
- Backlog is read in one query, unbounded. Bus is in-process, so multi-process servers would miss live events.
- 8 new black-box tests in `stream.test.ts`: 213 tests pass, types and lint clean.
