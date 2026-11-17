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

## Setup in a repository (v2)

The v2 Factory runs from `factory` (Supervisor CLI), `factory-server` (state) and `factory-cell` (execution).
In any repository you want the Factory to run:

```bash
# 1. scaffold the repo-owned definitions and check them
factory init --dir .            # writes .factory/ (lines/, operators/, templates/)
factory check --dir .           # validates .factory/ (and .nitpick/ when present)

# 2. start the server (one per Factory; writes its discovery file server.json into its data directory)
factory-server                  # or: factory run

# 3. run a Cell inside the repository (reads .factory/cell.toml over ~/.config/factory-cell/config.toml)
cd path/to/repo && factory-cell

# 4. feed it work
factory project add my-project --repo <url>
factory order create --project my-project --todo-id add-login --title "Add login" \
  --type feat --line feature --body "Add a login form."
factory plan create --project my-project --slug auth --members todos/a.md todos/b.md
factory todos import                 # dry run; add --apply to create the orders, once
```

`factory todos import` imports the repo's `todos/` folder into the server: plans, then standalone todos in
dependency order. It is a dry run unless `--apply` is given. Re-running is safe: files the server already has
are skipped. `--remove` deletes each file only after the server confirmed it. `factory todos export` writes
each server order that has no `todos/` file back to `todos/` and lists the orders it skipped. The project is
the repository's directory name unless `--project` says otherwise. `factory todos migrate` still works, with a
deprecation line, for one release. Remote servers work the same way with `FACTORY_URL` and
`FACTORY_TOKEN`. Every command accepts `--json`. The full CLI table is in [docs/PROTOCOL.md](docs/PROTOCOL.md) §10.

## Credits

Inspired by [gon-stack](https://github.com/polubis/gon-stack/tree/main).
