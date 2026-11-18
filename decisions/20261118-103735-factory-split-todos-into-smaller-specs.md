---
scope: factory
summary: Split the cells and jobs todos into 12 ordered smaller specs
why: One spec per cells, jobs and incidents slice keeps each task reviewable and sorts in build order.
date: 2026-11-18
tags: [factory, todos, planning]
---

- Replaces `04-cells-claims-and-leases`, `05-job-execution-and-worktree-lifecycle` and `06-incidents-and-sse-stream` with `01` to `12`.
- Specs live in the root `todos/` folder.
- Each spec keeps the original objective, scope, plan and acceptance items for its slice, and they form one Order Plan `cells-jobs-incidents`, a linear chain from `01` to `12` with `factory: v2`.
- `01`-`04` cover cells; `05`-`08` cover job transitions; `09`-`10` cover incidents; `11` covers SSE; `12` covers the entrypoint.
- Test commands use `@repo/factory-server-v2`, the package in `apps/factory-server`.
