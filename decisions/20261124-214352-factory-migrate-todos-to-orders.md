---
scope: factory/sf
summary: Move work order import and export to sf order
why: Glossary names work orders orders/*.md and sf order; todos/ and sf todos stay as fallbacks
date: 2026-11-24
---

- `sf order import|export` mount the import and export commands; `--dir` defaults to `orders/`, else `todos/` when only `todos/` exists (`DEFAULT_ORDER_DIR` in `config.ts`).
- `sf todos import|export` move to `legacy.command.ts` via `deprecatedAlias`: one stderr line `deprecated: use "sf order import|export"`, then the same stdout and exit code.
- `scripts/lint-todos.ts` lints `orders/` and `todos/`; `depends_on` resolves a slug in either folder.
- `setup` next-step hint and `docs/sf.md`, `docs/README.md`, root `README.md` name `sf order import`.
- Tests: `todos-queue.test.ts` covers `order import` fallback and `orders/` preference; `hq-names.test.ts` compares `sf todos` with `sf order` stdout, exit code and stderr; `lint-todos.test.ts` covers `orders/`.
- Not changed: HQ routes, DB columns, `/api/v1/queue/import|export`.
