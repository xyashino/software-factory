---
scope: software-factory/cell
summary: Signal on a Cell aborts its runner and hands the job back
why: SIGTERM only set an abort flag read between jobs, so a Cell mid-job ignored it and local-stop failed
date: 2026-11-21
tags: [cell, runner, signal]
---

- First SIGINT/SIGTERM on `sf cell start` aborts the running job's runner through `runtime.signal`, the same path as forced drain.
- Running job: runner stopped and exit confirmed, then `leave` with the job's epoch and jobId hands the job back; `startCell` resolves `stopped`, exit code 0.
- Runner still alive after abort: job fails `runner still alive after abort`, Cell leaves without claiming.
- Second SIGINT/SIGTERM: prints a warning that a runner may still be alive and exits 130 at once.
- Signal fired before the runner starts: the runner is started, then aborted at once and the job is handed back.
- Idle Cell still waits for its current claim poll before the signal is seen (not changed).
