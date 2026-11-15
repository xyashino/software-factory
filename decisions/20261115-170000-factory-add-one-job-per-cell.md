---
scope: factory/cell
summary: A Cell runs one Work order at a time; scale by running more Cells
why: One lease per Cell keeps capacity simple; parallel work comes from more Cells, which also isolate crashes
date: 2026-11-15
tags: [cell, queue, capacity, slots, config, protocol]
---

- A Cell process holds at most one live lease, so it runs at most one Job (one Work order) at a time.
  - The `slots` setting is removed from `config.toml`, `CellConfig`, the usage text and the startup log.
  - A config that still has `slots` is refused with an error that names the key.
- The claim loop is one loop: claim, run, run any continuation of the same Work order (PROTOCOL §4), claim again.
  - `runSlot` is `runClaimLoop`; `slotsDone` is `loopDone`.
- Parallelism comes only from more Cells: several instance directories on one machine (`hostname-N`, one data directory each), or Cells on other machines. The Factory sees every Cell as one unit of capacity.
- Contracts and runtime:
  - `hello` drops `slots`, and the request schema is strict, so a Cell that still sends it is refused. Cell and server ship together from this monorepo, so no compatibility shim.
  - `CellInfo` drops `slots`. A stored `cells.info` JSON that still has it keeps loading; the extra key is ignored.
  - The queue view replaces `freeSlots: number` with `busy: boolean`. A Cell is busy while it holds any live lease.
  - `selectClaimable` and `claimOnce` both read `busy`.
  - A busy Cell is never offered a second job, and a claim from it returns no job.
- Closes Q9 and Q21 in `docs/OPEN-QUESTIONS.md`.
- Tests:
  - `apps/cell/src/__tests__/config.test.ts` asserts the removed key is refused by name.
  - `apps/cell/src/__tests__/continuation.test.ts` asserts a continuation runs on the same Cell before the next claim.
  - `packages/factory-core/src/queue/__tests__/select.test.ts` asserts a busy Cell is offered no Work order.
  - `packages/factory-runtime/src/__tests__/command-loop.test.ts` asserts a busy Cell is offered nothing, and two Cells each claim one Work order.
  - `packages/factory-db/src/__tests__/stores.test.ts` asserts a stored `cells.info` with `slots` still loads.
