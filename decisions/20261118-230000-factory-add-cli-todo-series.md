---
scope: factory
summary: Add apps/factory todo series cli-01 to cli-11 and server drain todo
why: The apps/factory plan is ready, and the old operator-cli todos target a package the new layout replaces.
date: 2026-11-18
tags: [factory, cli, cell, operator, todos]
---

- Replaces the seven `step-0N-operator-*` todos (apps/operator-cli) with `cli-01` to `cli-11`, plus `server-drain-endpoint`.
- Numbering: `cli-NN-<slug>.md`. `step-01` to `step-03` stay with factory-server procedure work.
- Contracts are duplicated during implementation (cli-02), then moved to a shared package later.
- `server-drain-endpoint` adds `POST /api/v1/cells/{id}/drain` and `POST /api/v1/cells/leave`; `cell stop` depends on it.
- The new bin is `factory-2`, so it does not clash with `apps/cli` (`factory`). Cut-over is not planned yet; the Supervisor checks the flow manually first.
- No code written.
