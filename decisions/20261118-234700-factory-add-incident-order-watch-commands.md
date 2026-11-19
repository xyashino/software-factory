---
scope: factory
summary: Add Supervisor incident, order and watch commands with SSE reconnect
why: Supervisors need to resolve blocked work and see live transitions without raw HTTP, and a dropped stream must not lose or repeat a transition.
date: 2026-11-18
tags: [factory, cli, incidents, orders, watch, sse]
---

- `factory incident list [--project] [--order] [--reason] [--status] [--json]`: `GET /api/v1/incidents`. Table: id, reason, order, status, triage owner. `--project` defaults to the repo config project.
- `factory incident resolve <id> --action <retry_step|restart_from_step|restart_from_scratch|escalate|cancel> [--step <index>]`: `POST /api/v1/incidents/{id}/resolve` with `{action, stepIndex?}`.
- `--step` is a non-negative integer, required for `retry_step` and `restart_from_step`, refused for other actions. Missing or invalid input exits 2 with no request. The server decides which action fits the incident reason.
- `--report <file>` is refused with exit 2 and no request. The server's resolve contract has no report field, so the CLI does not invent one. Reading and sending the file waits for the server to accept it.
- `factory order show <id> [--json]`: `GET /api/v1/work-orders/{id}`. Prints the order line, steps, jobs and incidents. `--json` prints the raw reply.
- `factory order resume|reopen <id>` and `factory order cancel <id> --yes`: `POST /api/v1/work-orders/{id}/transitions` with `{action}`. Cancel without `--yes` exits 2 with no request.
- `factory watch [--project] [--after <seq>]`: `GET /api/v1/stream` with `Accept: text/event-stream`. Prints `seq  time  order  kind  summary` per transition. Ctrl-C exits 0.
- Reconnect: after a drop, reconnects with `afterSeq` set to the last printed seq, waiting 1 s, 2 s, 4 s, 8 s, then 10 s.
- The wait resets after a reconnect that delivers an event. Events at or below the last printed seq are skipped, so no seq prints twice.
- `readSseFrames` in `adapters/http/sse-client.ts` parses `text/event-stream` frames. Comment-only keepalives are dropped. `ServerPort.stream` takes an abort signal and yields parsed frames.
- Reconnect loop lives in the procedure, on the clock port, so the backoff is testable without a real server.
- `printTable` and `reportFailure` move to `adapters/cli/output.ts` and are shared by the queue and new commands.
