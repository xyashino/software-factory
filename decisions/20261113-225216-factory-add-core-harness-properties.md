---
scope: factory/core
summary: Add core testing harness, scenarios and invariant properties
why: CORE 10 invariants and the v1 scenario checklist now run against decide, nextJob and evolve
date: 2026-11-13
tags: [v2, core, testing, properties, factory]
---

- Dependency: v2-03 (`9dd4cea`, decide, nextJob, context) fast-forwarded into this branch before any work
- `@repo/factory-core/testing` subpath (`src/testing/`): harness with plain Error on mismatch
  - `given(events).when(cmd, by?, {epoch?}).then(events)`, `thenTypes`, `thenError`
  - `.and(cmd)` chains on the emitted events; `.apply()` keeps them; `.nextJob(expected)`
  - no vitest or fast-check in shipped code
- Fakes: `fakeClock`, `fakeIds` (ULID-shaped counters, `next()` for decide), `fakeBlobs` (`missing(...)`); line builder `lineBuilder()` checked against `makeLine()`
- Event and command builders moved from `order/__tests__/builders.ts` to `testing/event-builders.ts`; the old path re-exports them, so v2-02 and v2-03 tests are unchanged
- Scenarios: v1 feature and on-call names ported with `// v1: "<name>"` marks; 3 with no v2 counterpart (F1, F2, operator attempt fails) carry a written reason in `scenarios.checklist.test.ts`
- New v2 scenarios:
  - Andon to `resume{retry_station}` for all six reasons; `restart_from` after blocked and failed Cycles; reopen
  - lost and handover restarts; lost, handover and restart budgets run out apart
  - questions abandoned on block and on every ending command, answered, then shown in the resumed context
- Properties (fast-check) I1, I3-I9, I11 over generated Lines (1-6 Stations) and weighted intent sequences; `FACTORY_PROPERTY_RUNS` (default 500); `test:properties` runs 10 000 and passed in ~16 s
- A coverage test keeps the generator honest: Andons, deliveries and questions must occur in a share of sampled sequences
- Bug 1, fixed: a Line of only Inspections passed the schema and then made nextJob throw at row 16. The Line schema now needs one operator Station; this supersedes the v2-03 note that such a Line can reach row 16
- Bug 2, fixed: `resume{restart_from}` ahead of the Work order's Station skipped unpassed Stations and delivered without a checkpoint; decide now refuses it as precondition
- Bug 3, fixed: `resume` on a cancelled Work order was accepted with an Andon still raised; decide now refuses it, as it refuses terminal Work orders
- Mutation check: skipping the epoch bump in ClaimJob fails I5 on a shrunk two-intent sequence; reverted
