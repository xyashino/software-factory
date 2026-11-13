# Software Factory v2: design docs

> **Status: draft, nothing implemented (2026-11-13).**
> v1 lives in `packages/software-factory`. It is **not modified** by this work (one exception: the
> M9 todo filter, ROADMAP M9). It is the reference implementation, the source of carried-over code,
> and the tool that builds v2.

## Docs map

| File                                   | What it settles                                                                                                                    |
| :------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| [PLAN.md](PLAN.md)                     | Goals, non-goals, principles, architecture, components, trust boundaries, end-to-end flows, glossary                               |
| [CORE.md](CORE.md)                     | The domain: events, state, `evolve` / `decide` / `nextJob`, queue selection, invariants                                            |
| [PROTOCOL.md](PROTOCOL.md)             | How the Factory, Cells, `factory-operator` and `factory` talk: jobs, leases, fencing, idempotency, git checkpoints, failure matrix |
| [STORAGE.md](STORAGE.md)               | Database schema, the append transaction, projections, blobs, export/import, rebuild from git                                       |
| [STRUCTURE.md](STRUCTURE.md)           | Repo layout, package responsibilities, dependency rules, what is carried over from v1                                              |
| [RULES.md](RULES.md)                   | Hard implementation rules for every v2 change                                                                                      |
| [ROADMAP.md](ROADMAP.md)               | Milestones, acceptance criteria, the todo breakdown v1 executes                                                                    |
| [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) | Decisions not yet taken, each with a recommended default                                                                           |

Reading order: PLAN, CORE, PROTOCOL, STORAGE, STRUCTURE, RULES, ROADMAP.

## Precedence

When two documents disagree, the more specific one wins:
**RULES > CORE > PROTOCOL > STORAGE > STRUCTURE > PLAN > ROADMAP > OPEN-QUESTIONS > this README**.
A disagreement is a bug in the docs; fix it in the same change that notices it.

## Wording

- **MUST / MUST NOT**: a hard rule. Code that breaks it is wrong even if tests pass.
- **SHOULD**: the default; deviating needs a reason written in `decisions/`.
- **v1**: `packages/software-factory`. **v2**: everything described here.

## Names used throughout

The docs and the code use the factory vocabulary below. **The Factory** (capitalized) is the central
server; **the factory** (lowercase) is the whole system. PLAN's glossary has the full list.

| Name                   | In code                                                      | Meaning                                                                                      |
| :--------------------- | :----------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| **Factory**            | `apps/server`, bin `factory-server`                          | The central control point. Owns the database, the Lines, the schedule and the Travelers.     |
| **Cell**               | `apps/cell`, bin `factory-cell`; `CellId`                    | A replaceable compute device that joins, runs Cycles, and leaves at any time.                |
| **Line**               | `LineSnapshot`; `factory-definitions/lines/`                 | A declarative production workflow composed of Stations.                                      |
| **Station**            | `StationId`                                                  | One step on a Line: an Operator station or an Inspection.                                    |
| **Operator**           | `factory-definitions/operators/`; job `run_operator_station` | An AI specialist (profile + LLM runner) working an Operator station on a Cell.               |
| **Inspection**         | job `run_inspection`; `inspection_finished`                  | A deterministic command gate Station.                                                        |
| **Work order**         | `OrderId`, `WorkOrderState`                                  | One todo travelling down a Line.                                                             |
| **Cycle**              | `CycleId`, `CycleState`                                      | One execution of a Station on a Cell.                                                        |
| **Andon**              | `andon_raised`, `AndonReason`                                | A stop needing the Supervisor; raising it releases the Cell immediately.                     |
| **Handover**           | `handoverBlob`, `cycle_handed_over`                          | Context an Operator writes when it blocks or its Cell leaves, so work continues on any Cell. |
| **Traveler**           | the `events` rows of one Work order                          | The append-only event log of a Work order.                                                   |
| **Supervisor**         | actor `supervisor`; supervisor token                         | The person operating the `factory` CLI.                                                      |
| **`factory`**          | `apps/cli`                                                   | The Supervisor CLI. Talks only to the Factory.                                               |
| **`factory-operator`** | `apps/operator-cli`                                          | The CLI an Operator calls inside a Cell. Talks only to its local Cell.                       |
| **core**               | `packages/factory-core`                                      | Pure domain code shared by all of the above.                                                 |

"Operator" always means the AI specialist. v1's on-call operator becomes the **Line lead** (M10).
