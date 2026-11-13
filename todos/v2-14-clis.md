---
status: todo
priority: high
depends_on:
  [v2-10-factory-intake-stream-admin-e2e, v2-12-cell-operator-stations]
workflow: feature
---

# v2-14: CLIs — `factory` and `factory-operator`

## Objective

The two thin clients: `factory` for the Supervisor (board, Travelers, every control command) and
`factory-operator` for Operators inside a Cell.

## Read first

- `docs/PROTOCOL.md` §3.1, §3.3, §10, `docs/STRUCTURE.md` §1–2 (`apps/cli`, `apps/operator-cli`)
- v1: `packages/software-factory/src/cli/*`, `src/supervisor/console-lines.ts`, `src/paint.ts`
  (rendering ideas only; not carried over)

## Scope (ROADMAP items)

`factory-m6-operator-cli`, `factory-m6-cli`.

## Deliverables

1. `apps/operator-cli`: `done`, `verdict pass|fail --feedback`, `ask`, `tell`, `block --reason
--handover`, `context`; talks only to `$FACTORY_OPERATOR_SOCKET`; clear errors, non-zero exit.
2. `apps/cli`: every command of PROTOCOL §10 (status `--watch` via `/v1/stream`, show, log `-f`,
   answer, resume, reopen, nudge, cancel, prio, sync, cells, cells token, check, admin export);
   a ULID `commandId` per invocation reused on retries; `factory check` offline via
   `factory-definitions`.
3. Board and Traveler rendering (picocolors).

## Acceptance criteria

- `factory-operator` starts in < 100 ms (test).
- Each `factory` command tested against an in-process Factory.
- `pnpm turbo check-types lint test` green.
