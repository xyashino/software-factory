# software-factory

Monorepo hosting **SoftwareFactory** (`packages/software-factory`): an autonomous AI harness that turns
`todos/*.md` task specs into verified Pull Requests via multi-agent workflows in Herdr workspaces.
See [packages/software-factory/README.md](packages/software-factory/README.md).

Extracted from the omino monorepo with only the packages the factory needs:

| Package                       | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `packages/software-factory`   | The factory CLI (`sf`), roles, workflows, templates  |
| `packages/nitpick`            | Rules/skills engine; generates `.agents/` from `.nitpick/` |
| `packages/eslint-config`      | Shared ESLint config                                 |
| `packages/typescript-config`  | Shared tsconfig presets                              |

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
