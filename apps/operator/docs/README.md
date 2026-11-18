# `operator` — docs

The `operator` CLI is how an LLM agent reports back to its Cell. It is a thin client: it parses
arguments, reads the files they name, and sends one request to the Cell. It holds no rules and no
factory credentials.

Source of truth: [`apps/factory-server/docs`](../../factory-server/docs/PLAN.md). Section 11 defines
the endpoint, the verbs and their effects.

| Document | Covers |
| :------- | :----- |
| [PLAN.md](./PLAN.md) | CLI commands, options, exit codes, what the CLI checks |
| [../../../todos/](../../../todos/) | Ordered implementation steps: `step-01` to `step-07-*operator*` / `step-07-retire-operator-cli` |
| [IMPLEMENTATION_RULES.md](./IMPLEMENTATION_RULES.md) | Code shape, layering, verb and client rules, testing, verification gate |

## Glossary

| Term | Meaning |
| :--- | :------ |
| **Operator** | The LLM agent running one station of a Line |
| **Mechanic** | The LLM agent that triages an incident when a Line is blocked |
| **Cell** | The process on a machine that runs the agent and talks to the factory server |
| **Job** | One unit of work the server hands to a Cell: a station, or a Mechanic run |
| **Incident** | An Andon: a block the normal retries could not fix |

## Name

The binary is `operator` in these docs. The package today is `apps/operator-cli` under the name
`factory-operator`. Renaming is a separate change.
