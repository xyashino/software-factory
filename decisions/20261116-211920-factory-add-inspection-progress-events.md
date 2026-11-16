---
scope: factory/cell
summary: Add live inspection progress events and Traveler summaries
why: The logs tab stayed silent for a whole gate run; v1 printed each check start and finish as it ran
date: 2026-11-16
---

- order: `ReportInspectionProgress` command and `inspection_progress` event, one each, `phase` `started` or `finished`, `index` 1-based, `total`
- order: a finished check carries `exitCode`, `timedOut`, `durationMs`; a started check carries none; decide refuses a finished check without them
- order: `index` past `total` refused; only the Cell running the Inspection, fenced, live, on an inspection Station
- order: progress is informational: the Cycle stays running, no status, retry or count changes (evolve is a no-op)
- cell: `runChecks` sends started before each command and finished after its log blob is uploaded
- cell: a stale epoch stops the Inspection with no further command; any other progress refusal or transport error is dropped so the checks still run
- cli: `describeEvent` renders `▶`/`✓`/`✗` check lines with `(i/N)`, `exit N`, `timed out`, and durations `<1s`, `12s`, `1m05s`
- cli: summaries for inspection_finished, verdict_recorded, cycle_failed and cycle_blocked (with reason and detail), workspace_failed, delivery_*, usage_recorded, job_claimed, job_lost, resumed, reopened
- cli: `--json` untouched: stored events are unchanged apart from the new event type
- operator reminders (run-operator-station) stay journal-only; surfacing them needs its own order event, a follow-up
