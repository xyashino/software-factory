---
scope: docs
summary: Fix stale app names, Cell status and factory- rule
why: Operator app retired; apps/cell is live cell-server; factory- rule was a retired operator import ban
date: 2026-11-21
tags: [docs, cell, naming, contracts]
---

- Root README: "Workers" -> Cells, "Cycle" -> Job, "Worker" -> Cell. Env var `FACTORY_CYCLE_TOKEN` kept.
  - Open decision: rename `FACTORY_CYCLE_TOKEN` / `FACTORY_OPERATOR_URL` is a separate change.
- Removed `.tmp/omino-api` and `packages/factory-*` mentions from factory and sf docs.
- `factory-server` references in sf, web-demo and operator docs now point to `apps/factory` PLAN sections.
- sf PLAN title is `sf` CLI; `apps/cli` (old `factory` CLI) noted as removed.
- Operator names: no `operator-cli` or `@repo/factory-operator` in docs. `apps/operator` retired, so the operator README step-01..07 todo ref is moot.
- Cell status: `apps/cell` (`@repo/cell`) is live, not legacy.
  - `sf cell server start|stop|status` runs it detached (`apps/sf/src/adapters/cli/cell-server.command.ts`).
  - sf calls its HTTP API at `CELL_SERVER_URL`, default `http://127.0.0.1:7071`.
  - Cell daemon (`sf cell start`) is `apps/sf/src/application/procedures/cell/`; `apps/sf/src/cell/` holds helpers.
- `factory-` prefix rule: no naming rule exists.
  - Only source: `FORBIDDEN_PACKAGE` in the operator boundaries test, removed with `apps/operator`. It bans operator imports of `@repo/factory*`, not package names.
  - sf PLAN §7 now links `docs/contracts-plan.md`; `@repo/factory-contracts` and `@repo/cell-contracts` stay.
- `apps/cell/eslint.config.mjs` LEGACY rule bans `@repo/cell-*` imports. `cell-contracts-package` step must change that rule.
- Not changed, code: `apps/sf/src/domain/init/templates.ts` DOCTOR_PROFILE tells agents to run `factory-operator`; `sf` is the only bin. Fix in a code change.
- Not changed, tests: `apps/sf/test` fixtures use `factory-operator` strings.
- Not changed: `docs/docs-plan.md` keeps its problem list, which names the stale strings.
