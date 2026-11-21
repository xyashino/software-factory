# docs unification plan

## Goal

One home for docs, topic-based, no stale facts, no dead links, no copy of rules that `.nitpick` owns.

## Verified facts

- Docs today: `apps/factory/docs` (PLAN 911 lines, BE_RULES 215, README 28), `apps/sf/docs/PLAN.md` (246), `apps/sf/docs/OPERATOR.md`, `apps/web-demo/docs/PLAN.md` (90). `apps/cell` has no docs.
- 19 dead links: factory `README.md` + `PLAN.md` to `todos/01..06` and `todo/README.md`; web-demo `PLAN.md` to `todos/web-demo-01..06`. Those todos are gone, task tables stale.
- Stale names: the dead operator app was retired by `operator-retire-app-and-protocol`; its docs moved to `apps/sf/docs/OPERATOR.md`. Factory README mentions `.tmp/omino-api`, `packages/factory-*`. Root README uses old Workers/Cycle terms.
- sf PLAN says legacy Cell app removed, but `apps/cell` exists. Status unclear.
- sf PLAN §7: shared contracts package "must not start with `factory-`, operator boundary rule forbids that prefix", BE_RULES needs exception. Rule text NOT found in operator docs (only "operator MUST NOT import from `apps/factory`"). Conflicts with name `@repo/factory-contracts` in `docs/contracts-plan.md`.
- BE_RULES §3 and operator IMPLEMENTATION_RULES §3 restate `.nitpick` rules: no barrel, export order, strict types, minimal comments. Arrow-functions-only appears in both docs; not in the CLAUDE.md rule list.
- Factory PLAN mixes design with: DB schema §7 (~180 lines, duplicates `apps/factory/src/db/schema`), endpoint index §9 (duplicates contracts), roadmap §10 (stale).
- Glossary only in operator README (retire todo moves it to `apps/sf/docs/OPERATOR.md`). Root README links sf and factory plans.
- ADR scope `docs` allowed by `.nitpick/config.ts`.

## Target layout (assumed, confirm before `docs-restructure-root`)

```
docs/
  README.md        index + glossary
  architecture.md  apps, who talks to whom, diagram
  factory.md       server design
  sf.md  operator.md  web-demo.md  cell.md
  engineering.md   layering + dependency rules (merged RULES)
  plans/           *-plan.md
```

Each app keeps a short `README.md` pointing into `docs/`. Dropped, not moved: DB schema dump, endpoint index, roadmaps, task tables, code-style sections.

## Order

| Todo | What | Depends on |
| --- | --- | --- |
| `operator-retire-app-and-protocol` | Delete dead operator app + protocol package | none |
| `docs-fix-stale-facts` | Names, terms, cell status, `factory-` rule | operator-retire |
| `docs-remove-dead-sections` | Dead links, task tables, roadmaps, schema dump, endpoint index | fix-stale-facts |
| `docs-dedupe-style-rules` | RULES style sections to `.nitpick` links | remove-dead-sections |
| `docs-restructure-root` | Move + merge into `docs/` | dedupe-style-rules |
| `docs-write-cell-doc` | New `docs/cell.md` | restructure-root |
| `docs-link-check` | Script + `ci:verify` gate | restructure-root |

One ADR per todo when done. Importer allows one `depends_on` parent only, so the docs chain is linear: retire, fix-stale, remove-dead, dedupe, restructure, then cell-doc and link-check in parallel. Markdown follows `general-caveman-markdown`.

## Open decisions

- Root `docs/` by topic vs per-app: plan assumes root. Confirm.
- `apps/cell` status: decided inside `docs-fix-stale-facts` from code.
- `factory-` prefix rule: find origin or drop; result decides contracts package name (`docs/contracts-plan.md`).

## Risks

- Moving files breaks inbound links (root README, operator README, sf PLAN, todos, ADRs). Link check lands last, so grep manually in restructure step.
- Deleting endpoint index before contracts package lands leaves no API overview: point to `apps/factory/src/contracts` now, repoint later.
- Layering rules as `.nitpick` rule is optional and larger: decide in `docs-dedupe-style-rules`.

## Verify

`pnpm ci:verify` per todo; `pnpm nitpick:check` when `.nitpick/` changes.
