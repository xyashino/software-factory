# software-factory

Monorepo hosting **SoftwareFactory** (`packages/software-factory` v1, and [v2 design docs](docs/README.md)): an autonomous AI harness that turns
`todos/*.md` work orders into verified Pull Requests via declarative production lines.
See [packages/software-factory/README.md](packages/software-factory/README.md).

## Main idea

The system is modeled as an automated software factory:

- **The Factory** (central server) is the single control point holding blueprints (Lines, Stations, Operators), the schedule, **Traveler** records (append-only event logs), and the board.
- **Workers** are replaceable compute machines that connect outbound to the Factory, claim a **Cycle** on a **Station**, execute it, push git checkpoints and artifacts, and can disconnect at any time without losing completed work.
- **Lines** are declarative production workflows composed of **Stations**—either an **Operator** (an AI specialist such as `planner`, `builder`, `reviewer`, `auditor`) or an **Inspection** (a deterministic command gate).
- **Work orders** (`todos/*.md`) travel down a Line from station to station. If an Operator or Inspection hits a blocker, it raises an **Andon** (releasing the Worker immediately) with a **Handover** so a human supervisor can resolve it and resume on any available Worker.

Extracted from the omino monorepo with only the packages the factory needs:

| Package                      | Purpose                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `packages/software-factory`  | The factory CLI (`sf`), roles, workflows, templates        |
| `packages/nitpick`           | Rules/skills engine; generates `.agents/` from `.nitpick/` |
| `packages/eslint-config`     | Shared ESLint config                                       |
| `packages/typescript-config` | Shared tsconfig presets                                    |

## Prerequisites

- [mise](https://mise.jdx.dev/): `mise install` (Node 24, pnpm 12.15.0)
- [Bun](https://bun.sh/) (the factory runs on Bun)
- `herdr`, `gh` and the agent CLIs used in `packages/software-factory/workflows/*.yml`

## Usage

```bash
pnpm install
pnpm sf check     # validate roles, workflows and templates
pnpm sf:status    # list tasks
pnpm sf:run       # run the supervisor over todos/
pnpm ci:verify    # format, lint, typecheck, test, build
```

## Credits

Inspired by [gon-stack](https://github.com/polubis/gon-stack/tree/main).
