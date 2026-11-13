---
status: todo
priority: medium
depends_on: [v2-16-portability]
workflow: standard
---

# v2-17: Cut-over preparation — v1/v2 todo split

## Objective

Let v1 and v2 run side by side on this repository without ever taking the same todo, so the
one-week parallel trial of ROADMAP M9 can start.

## Read first

- `docs/ROADMAP.md` M9, `docs/README.md` (the one allowed v1 edit)

## Deliverables

1. `decisions/` entry for the one v1 change.
2. v1 `packages/software-factory/src/supervisor/pick-todo.ts`: skip todos whose frontmatter has
   `factory: v2`; test for it.
3. v2 intake cut-over flag documented in the Factory config (only `factory: v2` todos while on).
4. A short trial runbook in `docs/` (how to mark trial todos, what to watch, the exit criteria).

## Out of scope

Running the trial and switching `sf` scripts to `factory`: done by the Supervisor after the trial.

## Acceptance criteria

- v1 test proves a `factory: v2` todo is never picked.
- `pnpm turbo check-types lint test` green.
