---
scope: factory
summary: Add plan for one factory CLI covering server, cell, todos, queue and operator
why: The new core needs one command surface, and the Cell's loop and the operator endpoint must be described before code exists.
date: 2026-11-18
tags: [factory, cli, cell, operator, plan]
---

- New `apps/factory/docs/PLAN.md`: one `factory` binary with groups server, cell, todos, queue, incident, order, watch, operator.
- Command name is `cell`, not `call`.
- Command-to-endpoint table ties each command to a route in factory-server PLAN §9 or §11.
- Cell lifecycle written from factory-server PLAN §3: enroll, hello, claims, Line and worktree checks, start, runner, heartbeat, finish, deliver, failure.
- `factory operator` is a subcommand of the same binary; the agent sees only its endpoint and token.
- The Cell daemon lives in `apps/factory/src/cell`. This reverses the earlier plan to keep `apps/cell` separate.
- The new approach is built alongside the current implementation; the current one stays until cut-over.
- `factory server stop` stops only the server. Cells keep running and retry with the same `commandId`.
- Gap noted: no server drain or leave endpoint, so `cell stop` cannot hand over a Job cleanly yet.
- Shared Zod contracts are duplicated during implementation and moved to one package later.
- Layout follows `.tmp/omino-api`: domain, contracts, application (ports and procedures per command), adapters, bootstrap, tests. The `.tmp` reference uses barrel `index.ts` files; this plan drops them to match the repo rules.
- Runners in v2.0: all five ship (`claude`, `codex`, `cursor`, `antigravity`, `opencode`).
- No code written.
