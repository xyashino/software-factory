# Docs

Index of project docs, by topic. Each app keeps a short `README.md` pointing here.

- [architecture.md](./architecture.md): apps, who calls whom, one diagram.
- [factory.md](./factory.md): HQ server design. State, Cell lifecycle, incidents, queue, tokens, agent reporting.
- [sf.md](./sf.md): `sf` CLI. Command tree (`sf hq` for HQ), Cell daemon, operator verbs, shared contracts.
- [operator.md](./operator.md): `sf operator` client. Commands, exit codes, request shape.
- [cell.md](./cell.md): Cell daemon, Factory daemon (`sf factory`), operator endpoint, local data.
- [web-demo.md](./web-demo.md): Astro web UI served by `sf web start`.
- [engineering.md](./engineering.md): backend layering, transactions, SQLite, testing.
- [hq-factory-cell-plan.md](./hq-factory-cell-plan.md): Factory and Cell design, open gaps.
- [onboarding-plan.md](./onboarding-plan.md): open onboarding gap.
- Repo rules (style, commits, tests): `.nitpick/`, generated into `CLAUDE.md` and `.agents/`.

## Glossary

Defined once here. Other docs link to this section.

| Term           | Meaning                                                                                              |
| :------------- | :--------------------------------------------------------------------------------------------------- |
| **HQ**         | External server: state, queue, projects, work orders, jobs, leases. Holds the transition log         |
| **Factory**    | Local daemon, one per PC. Only holder of the HQ credential. Spawns, supervises and kills Cells       |
| **Cell**       | Disposable worker: one process, one job at a time, runs inside a repo. Talks only to its Factory     |
| **Project**    | A repo containing `.factory/config.json` (field `project`)                                           |
| **Line**       | Declarative workflow: an ordered list of Stations (`.factory/lines/<name>.yml`)                      |
| **Station**    | One step of a Line. An Operator run or a deterministic Inspection                                    |
| **Operator**   | The LLM agent running one Station of a Line                                                          |
| **Mechanic**   | The LLM agent that triages an Incident when a Line is blocked                                        |
| **Job**        | One execution attempt of one Station, claimed by a Cell. Also a Mechanic run                        |
| **Incident**   | An Andon: a block that normal retries could not fix. Releases the Cell                               |
| **Work order** | One `todos/*.md` item travelling down a Line                                                         |
| **Supervisor** | The human who runs HQ and resolves Incidents                                                         |

Code keeps older names: `apps/factory` is HQ, `apps/sf` holds the Cell and Factory daemons. Docs use the terms above. Old command and env names are listed in [sf.md](./sf.md#deprecated-names).
