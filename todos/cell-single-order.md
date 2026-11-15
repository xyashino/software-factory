---
status: todo
priority: high
depends_on: []
line: feature
factory: v2
---

# cell-single-order: A Cell works one Work order at a time; scale by running more Cells

## Objective

Remove `slots`. One `factory-cell` process holds at most one Job (so one Work order) at a time. Parallelism comes only from running more Cells, on the same machine (instance directories, `hostname-2`, …) or on other machines. The Factory sees every Cell as one unit of capacity.

## Read first

- `docs/PROTOCOL.md` (§4 continuation, §5, `/v1/cell/hello`, `/v1/cells`), `docs/CORE.md` (queue selection, `freeSlots`), `docs/PLAN.md`, `docs/OPEN-QUESTIONS.md` (Q9, Q21)
- `apps/cell/src/config.ts`, `usage.ts`, `main.ts`, `cell.ts`, `loops/claim.ts`, `jobs/send.ts`, `workspace.ts`, `instance-lock.ts`
- `packages/factory-core/src/contracts/cell.ts`, `ports/cells.ts`, `ports/lease-store.ts`, `queue/types.ts`, `queue/select.ts`
- `packages/factory-runtime/src/cells.ts`, `queue.ts`, `claim.ts`

## Deliverables

1. **Cell (`apps/cell`):**
   - Drop `slots` from `config.toml` (an old config containing it gets a clear error naming the key), `CellConfig`, `usage.ts` and the startup log.
   - Replace the N claim loops in `cell.ts` with one loop: claim → run → run any continuation of the same Work order (PROTOCOL §4) → claim again. Rename `runSlot`/`slotsDone` accordingly.
   - Keep the multi-instance support (`instance-lock.ts`, join name `hostname-N`, one data directory per instance) as the way to run several Cells on one machine. Remove the "two slots of one Cell" mirror comment in `workspace.ts`; mirrors are per instance directory.
2. **Contracts & runtime (`factory-core`, `factory-runtime`):**
   - Remove `slots` from the `hello` request schema and `CellInfo`. Replace `freeSlots: number` with `busy: boolean` (a Cell is free when it holds no live lease) in the queue view, `selectClaimable` and `claim.ts`.
   - A `claim` from a Cell that already holds a live lease returns no job (defensive: the runtime never hands a busy Cell a second job).
   - Stored `cells.info` JSON from before keeps loading: an extra `slots` field is ignored on read.
3. **Tests:** update every test that sets `slots` (cell, server e2e fake-cell, distributed harness, runtime test-kit, queue builders). Add: a busy Cell is never offered a second job; a continuation runs on the same Cell before it claims again; two instances on one machine each run one Work order in parallel.
4. **Docs:** PROTOCOL (hello, `/v1/cells`, §4 "same slot" → "same Cell", config tree), CORE (`freeSlots` → `busy`), PLAN diagram ("N slots"), STRUCTURE, STORAGE `cells.info`; close Q9 and Q21 in OPEN-QUESTIONS with this decision; one `decisions/` ADR.

## Acceptance criteria

- [ ] No `slots` setting or field remains in code, contracts or docs.
- [ ] A Cell never holds more than one live lease; parallel work needs more Cells.
- [ ] `pnpm ci:verify` passes.
