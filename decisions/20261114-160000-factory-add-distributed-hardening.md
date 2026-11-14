---
scope: factory/distributed
summary: Real-process distributed suite behind a hostile proxy, five fixes
why: Proves R2, R3 and R8 with real Factory and Cell processes; the suite exposed five defects that unit tests missed
date: 2026-11-14
tags: [v2, distributed, harness, takeover, partition, duplicates, leave]
---

- Harness: `apps/cell/src/__tests__/distributed/`.
  - One `factory-server` process, N `factory-cell` processes.
  - A fake runner (`claude`, `cursor-agent` shims that dispatch to the scripted Operator by role) and a fake `gh`.
  - A per-Cell HTTP-aware proxy: `delay`, `dropRequests`, `dropResponses`, `cut`, `heal`.
  - Each child runs in its own session, so `kill -9` takes its runner too.
- Separate vitest config (`vitest.distributed.config.ts`, `fileParallelism: false`, no retries).
  - `test` excludes the directory; `test:distributed` runs it.
  - CI jobs: `distributed` (once) and `distributed-soak` (20 runs).
- Server timing knobs in `apps/server/src/runtime-config.ts`; unset means production defaults.
  - `FACTORY_LEASE_TTL_MS`, `FACTORY_HEARTBEAT_MS`, `FACTORY_REAPER_MS`, `FACTORY_SELF_FENCE_MS`, `FACTORY_CLAIM_TICK_MS`.
  - Self-fence not below the lease TTL is refused.
- Cell config `headless_operators` (default false) runs Operator stations as headless runners without Herdr; only the suite turns it on.
- Fixes, each with a failing test first:
  - Remote `submitCommand` carried no `jobId`, so the codec refused every remote command (`remote-submit.test.ts`).
  - The Cell dropped the continuation a job-ending command returned; the job then lapsed on its lease (`continuation.test.ts`).
  - A leaving Cell now releases the continuation it will not run with `ReleaseJob` (`continuation.test.ts`, PROTOCOL §9).
  - `ReleaseJob` handed the continuation straight back to the releasing Cell.
    - A release never continues now (`command-loop.test.ts`).
  - A late command for a lost lease answered 500; it now answers 409 `stale_epoch` as PROTOCOL §11 says (`http-commands.test.ts`).
- Not done: `factory-m7-race` still fails (see `report.md`); the 20-run soak has not passed.
