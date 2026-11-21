---
scope: factory
summary: Plan shared packages and docs unification, add todos
why: apps duplicate DB plumbing and wire contracts, and docs are stale and scattered
date: 2026-11-21
tags: [todos, database, contracts, docs, operator, skills]
---

- `docs/bun-sqlite-kit-plan.md`, `docs/contracts-plan.md`, `docs/docs-plan.md`: goals, verified facts, decisions, order, risks.
- SQLite: `bun-sqlite-kit-package`, `factory-adopt-bun-sqlite-kit` todos; cell adoption note in `.notes/`.
- Contracts: `zod-contract-kit-package`, `factory-contracts-package`, `cell-contracts-package`, plus sf and web-demo adoption todos.
- Docs: `docs-fix-stale-facts`, `docs-remove-dead-sections`, `docs-dedupe-style-rules`, `docs-restructure-root`, `docs-write-cell-doc`, `docs-link-check`.
- Kits stay pure and client-safe; `withZodSchema` stays server-side; no db-cell/db-factory packages.
- Operator: `operator-retire-app-and-protocol` removes dead `apps/operator` and `packages/operator-protocol`; docs todos now depend on it.
- `.nitpick/skills/create-todo`: rewritten to match the importer (type, plan, one depends_on parent), lines table, verify-first, ADR and test defaults, ASCII only.
- All todos: `type` added, one-parent chain (docs chain linearized), ADR criterion added. `todo-lint-script` todo added.
- No product code changed.
