---
scope: factory/sf
summary: Add e2e coverage for plan activation to root worktree on origin
why: Plan branch tests used local main, so a remote-only plan base passed unit tests and failed in production
date: 2026-11-24
---

- Blackbox e2e runs `plan_branch` through `runJob` against a bare local origin, then starts the root worktree from `feat/<plan>`.
- The e2e fails when the origin fallback in `git.ts` or the `plan_branch` handler in `run-job.procedure.ts` is reverted.
- Unit test covers a root worktree whose plan base exists only on origin.
- No network: origin is a local bare repo.
