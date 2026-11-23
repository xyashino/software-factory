---
scope: docs
summary: Add standalone apps/factory and --local execution workplan
why: Factory daemon needs extraction to apps/factory with --local SQLite execution and HQ <-> Factory <-> Cells chain
date: 2026-11-23
tags: [factory, hq, todos, plan, docs]
---

- Add `docs/standalone-factory-plan.md` covering `HQ <-> Factory <-> Cells` topology, standalone `apps/factory`, and `--local` mode vs HQ forwarding.
- Link `standalone-factory-plan.md` from `docs/README.md`.
- Add 5 chained todo specs in `todos/` (`plan: standalone-factory`, `line: standard`):
  - `todos/factory-contracts-package.md`: `@repo/factory-contracts` for Factory loopback schemas.
  - `todos/factory-app-extract.md`: extract `apps/sf/src/factory/*` into standalone `apps/factory` (`@repo/factory`).
  - `todos/factory-local-engine.md`: embed local SQLite execution engine in `apps/factory` when disconnected from HQ.
  - `todos/factory-queue-import-endpoint.md`: move `todos/*.md` import handling to `POST /queue/import` on `apps/factory` with `local` vs HQ gate.
  - `todos/sf-local-mode-cli.md`: add `--local` flag to `sf todos`, `sf queue`, `sf order`, `sf incident`, and `sf watch`.
- Verified with `bun run todo:lint` and `bun run docs:check`.
