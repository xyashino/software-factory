# Docs

Index of project docs, by topic. Each app keeps a short `README.md` pointing here.

- [architecture.md](./architecture.md): apps, who calls whom, one diagram.
- [factory.md](./factory.md): server design. State, Cell lifecycle, incidents, queue, tokens, agent reporting.
- [sf.md](./sf.md): `sf` CLI. Command tree, Cell daemon, operator verbs, shared contracts.
- [operator.md](./operator.md): `sf operator` client. Commands, exit codes, request shape.
- [web-demo.md](./web-demo.md): Astro web UI served by `sf web start`.
- [engineering.md](./engineering.md): backend layering, transactions, SQLite, testing.
- [plans/](./plans/): open designs. Contracts, SQLite kit, docs.
- Repo rules (style, commits, tests): `.nitpick/`, generated into `CLAUDE.md` and `.agents/`.

## Glossary

Defined once here. Other docs link to this section.

| Term         | Meaning                                                                          |
| :----------- | :------------------------------------------------------------------------------- |
| **Factory**  | Central server. Holds Lines, Work orders, Jobs, Incidents and the transition log |
| **Line**     | Declarative workflow: an ordered list of Stations                               |
| **Station**  | One step of a Line. An Operator run or a deterministic Inspection               |
| **Operator** | The LLM agent running one Station of a Line                                      |
| **Mechanic** | The LLM agent that triages an Incident when a Line is blocked                    |
| **Cell**     | Replaceable machine process that connects out to the Factory and runs Jobs      |
| **Job**      | One unit of work the Factory hands to a Cell: a Station, or a Mechanic run      |
| **Incident** | An Andon: a block that normal retries could not fix. Releases the Cell          |
| **Work order** | One `todos/*.md` item travelling down a Line                                  |
| **Supervisor** | The human who runs the Factory and resolves Incidents                         |
