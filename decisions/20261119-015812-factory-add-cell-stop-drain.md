---
scope: factory
summary: Add factory cell stop with a clean drain and handover
why: "Stop a cell without losing work: it finishes its station or hands its Job over, never silently drops it."
date: 2026-11-19
tags: [factory, cell, drain]
---

- `factory cell stop --id <id> [--force]` sends one `POST /api/v1/cells/{id}/drain` and prints `cell <id> draining`. It does not wait.
- Default drain: the running station finishes, its normal transition is sent, then the cell leaves with no `jobId`.
- If the transition hands a next Job to the draining cell, the cell leaves with that Job's `jobId` and `epoch`, so the server re-queues it.
- `--force` drain: runner gets SIGTERM, then SIGKILL after 5 s. The cell leaves with the current `jobId` and `epoch`. No transition is sent.
- Idle cell: leaves with no `jobId` and `epoch` 0, then exits 0. It never claims while draining.
- Claim replies carry `signals: ['drain']` for a draining cell, so an idle cell learns of the drain on its next claim reply.
- Drain policy is a pure table (`drain-policy.ts`): no job leaves now; force aborts; otherwise wait for the station, then leave.
- Leave answered `409 stale-lease-epoch` exits 0 and prints that the server had already moved the Job.
- Cell status `left` is accepted by `factory cell list`. Heartbeat parses `drain` and `force` signals.
- Known limit: an idle draining cell waits up to the claim long-poll (`CLAIM_WAIT_MS`) before it sees the drain.
