---
status: todo
priority: high
depends_on: [v2-01-workspace-skeleton]
workflow: feature
---

# v2-02: Core model — ids, events, state, evolve, projection

## Objective

Implement the data model of `factory-core`: identifiers, the Traveler event catalogue with zod
schemas, `WorkOrderState`, `evolve`, derived holder/board status and the pure projection fold.
After this todo, any history of events folds into a well-defined state.

## Read first

- `docs/CORE.md` §1–4, §10–11 (the whole of §4.3 evolve rules is normative)
- `docs/STORAGE.md` §4 (`orders` columns) and §6, `docs/RULES.md` §1–2
- v1 for reference only: `packages/software-factory/src/engine/{events,state,reduce}.ts`

## Scope (ROADMAP items)

`factory-m1-ids-result`, `factory-m1-events`, `factory-m1-ports`, `factory-m1-state-evolve`.

## Deliverables

1. `src/ids.ts` (branded `OrderId`, `TodoId`, `ProjectId`, `StationId`, `CellId`, `JobId`,
   `CycleId`, `ResumeId`, `QuestionId`, `BlobRef`, `CommitSha`), `src/result.ts`.
2. `src/line/`: `LineSnapshot` type and Station lookup (no parsing, no hashing).
3. `src/order/events.ts`: every event of CORE §3.3 and the `StoredEvent` envelope, as zod schemas;
   4 KiB caps on free text; `upcast.ts` with the identity upcaster for `schemaVersion: 2`.
4. `src/order/state.ts`, `evolve.ts`: every rule of CORE §4.3, including the liveness guard and its
   two exceptions (`usage_recorded`, `question_answered`), `resumed` per Andon reason (rule 7),
   `restart_from` (rule 8), `reopened` (rule 9).
5. `src/order/status.ts`: `holderOf` and board status (CORE §4.2).
6. `src/order/projection.ts`: `toProjection(state)` producing exactly the `orders` row of
   STORAGE §4, including `avoidCells` derived from `workspaceFailures` with
   `WORKSPACE_COOLDOWN_MS`.
7. `src/ports/`: `EventStore`, `BlobStore`, `LeaseStore`, `Clock`, `Ids` interfaces (STORAGE §2).

## Out of scope

`decide`, `nextJob`, context, queue (later todos). No fakes yet beyond what tests need.

## Acceptance criteria

- Unit test per event type for `evolve`, and per evolve rule of CORE §4.3.
- I2 schema test: no event schema accepts an absolute path, hostname or pane-id pattern.
- `toProjection` test per column.
- Purity test still green; `pnpm turbo check-types lint test` green.
