---
scope: factory
summary: Linearize the factory-cli todo chain so the plan validator accepts it
why: The plan validator allows one chain per plan with no forks or joins, and cross-plan dependencies are invalid. The cli-01..cli-11 graph had forks and joins, so todos migrate rejected all 12 files.
date: 2026-11-18
tags: [factory, cli, todos, plan]
---

- `cli-01` to `cli-11` and `server-drain-endpoint` now form one chain in `factory-cli`, in this order: `cli-01`, `cli-02`, `cli-03`, `cli-04`, `cli-05`, `cli-06`, `cli-07`, `cli-08`, `cli-09`, `cli-10`, `server-drain-endpoint`, `cli-11`.
- Each todo `depends_on` only its predecessor. Former parallel edges (for example `cli-05` and `cli-06` both on `cli-04`) are serialized.
- `server-drain-endpoint` drops its cross-plan dependency on `step-02-adapter-declared-sections`. It is recorded as a prerequisite note in the todo body.
- Checked with the repo's `scanTodos`: `factory-cli` yields a valid chain with no `plan_invalid` diagnostics.
- No code written.
