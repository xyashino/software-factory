---
status: todo
priority: high
depends_on: [v2-12-cell-operator-stations]
workflow: feature
---

# v2-13: Cell — delivery and first real end-to-end run

## Objective

Deliver finished Work orders as one squashed PR, then prove the whole Factory + Cell stack on a real
fixture repository.

## Read first

- `docs/PROTOCOL.md` §8.3 (delivery), §11 (base branch moves, PR closed)
- `docs/CORE.md` §6 rows 14 and 16, §4.3 rules 9–10
- v1: `src/supervisor/{deliver,delivery-commit,validate-pr,format-pr-body}.ts`

## Scope (ROADMAP items)

`factory-m5-deliver`, plus the M5 "done when".

## Deliverables

1. `jobs/deliver.ts`: rebase on current `origin/<baseBranch>`, squash (`reset --soft`), commit
   message from the `deliver.commit` artifact, remove the todo file, dry run, force-with-lease push,
   PR create-or-find (open PR for the branch), `ReportDelivery`; rebase conflict →
   `delivery_failed`.
2. PR body from `deliver.bodyBlob` (rendered by the Factory).
3. Reopen path verified: a reopened Work order delivers again onto the same branch / PR.

## Acceptance criteria

- E2E test: a fixture repo Work order delivered end to end with a scripted fake runner and a fake
  GitHub adapter.
- Manual run once with a real runner against a scratch repository; record the result in
  `decisions/` (what worked, what needed fixing).
- `pnpm turbo check-types lint test` green.
