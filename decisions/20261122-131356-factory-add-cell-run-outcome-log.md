---
scope: factory
summary: Log every cell run end and runner abort
why: VPS incident left no end line for the first run, so the second claim was unexplained
date: 2026-11-22
tags: [cell, logging]
---

- `runOperator` logs `end kind=<aborted|drain-force|timeout|exited|operator> exit=<code> duration=<s>` for every run end.
- Every runner abort logs `abort reason=<timeout|drain-force|heartbeat|operator> confirmed=<yes|no>`; `confirmed=no` when `runner.abort` throws.
- Heartbeat abort logs `reason=heartbeat failures=<n>`; `startHeartbeat` passes its consecutive failure count to `onAbort`.
- Same `<station> <action> <detail>` line format as existing entries; no token or credential logged.
- Tests in `run-job-log.test.ts`: one line per outcome, refused abort, no token in output.
