---
scope: factory
summary: Remove todo specs for tasks already shipped on main
why: Queue must list only open work; shipped specs were still marked queued
date: 2026-11-24
---

- Deleted five `todos/` specs whose acceptance criteria are met in code: `hq-storage-port-sqlite`, `hq-postgres-adapter`, `sf-plan-activate-verb`, `sf-job-kind-coverage`, `sf-plan-branch-e2e`.
- Evidence checked: `StoragePort` and sqlite/postgres adapters in `apps/hq`, `plan activate` and `show` in `apps/sf/src/adapters/cli/plan.command.ts`, job-kind coverage test, plan-branch e2e test.
- Kept the rest: `sf order test` is absent from `order.command.ts`, and `plan_branch` reset from scratch is not implemented.
- Spec status fields all still read `queued`, so the done check was by code, not by status.
