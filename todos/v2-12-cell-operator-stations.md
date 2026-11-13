---
status: todo
priority: high
depends_on: [v2-11-cell-foundation]
workflow: feature
---

# v2-12: Cell — Operator stations, checkpoints, Operator socket, panes, leaving

## Objective

Run Operator stations on a Cell: headless and Herdr-pane runners, the checkpoint procedure with
dry run and force-with-lease, the local Operator socket, the Cycle runtime (watch, signals,
question hold) and Handover when the Cell leaves.

## Read first

- `docs/PROTOCOL.md` §3.3, §7, §8 (§8.2 checkpoint procedure is normative), §9 (execution steps,
  leaving table)
- `docs/CORE.md` §9 (watch, question hold, runtime journal), `docs/PLAN.md` F2, F3, F5
- v1: `src/engine/watch.ts`, `src/supervisor/{headless,launch,trust-prompt,names}.ts`

## Scope (ROADMAP items)

`factory-m5-headless-station`, `factory-m5-operator-socket`, `factory-m5-pane-runtime`,
`factory-m5-leave`.

## Deliverables

1. `factory-core/src/cycle/watch.ts` (port of v1 1:1) and `policy.ts`.
2. `jobs/run-operator-station.ts`: workspace → `StartCycle` → download inputs → launch (headless
   first, then Herdr pane) → loop → `RecordUsage`.
3. `checkpoint.ts`: validate → upload → commit with trailers (incl. `Factory-Outcome`) → dry run →
   fetch + `--force-with-lease` push (3 tries) → send; failed-Cycle WIP to
   `factory-wip/<todoId>/<cycleId>`.
4. `operator-socket.ts`: unix socket (`0600`), per-Cycle token, verbs of PROTOCOL §3.3.
5. `cycle/`: observe → `watch` → remind / fail / block; signals `answer` and `nudge` typed with
   `runtimePrompts`; question hold (30 min + 5 min); runtime journal.
6. Leaving on `SIGTERM` per the PROTOCOL §9 table (`HandOverCycle` or `ReleaseJob`).

## Acceptance criteria

- With a scripted fake runner: done, verdict pass/fail, block, ask/answer, nudge, timeout, leave
  with Handover — each a test against an in-process Factory and a local bare git remote.
- A stale epoch at dry run never pushes (test).
- `pnpm turbo check-types lint test` green.
