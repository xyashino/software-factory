---
name: setup-factory
description: "Prepares a machine to run the v2 software factory: checks prerequisites, writes the Cell config, registers a project, starts factory-server and factory-cell, and verifies intake. ONLY activate when explicitly requested by the user (e.g., 'use setup-factory', 'set up the factory', 'configure the factory on this machine'). Never activate automatically."
---

# Setup Factory Skill

## 🎯 Activation (Explicit Only)

Never activate this skill automatically. Activate only when the user explicitly asks to set up, configure or start the factory on this machine.

## 🚫 Rules

- Ask before writing anything outside the repository, and before overwriting any existing config.
- Back up an existing file before changing it: `<file>.bak`.
- Never commit, push or open a PR unless the user asks for it.
- Never print or store tokens, credentials or `gh` auth data.
- Do not use `sf` or the v1 scripts. The v2 commands are `pnpm factory`, `pnpm factory-server` and `pnpm factory-cell`.
- Do not guess machine paths or the repository URL. Ask the user, or read them from the environment.

## 1. Check prerequisites

Run each check and report the result. Stop and report if a required tool is missing.

| Tool | Check | Needed for |
| :-- | :-- | :-- |
| bun | `command -v bun` | every v2 process |
| pnpm | `command -v pnpm` | the `pnpm factory*` scripts |
| git | `git --version` | worktrees, mirrors |
| gh | `gh auth status` | pull requests (the Cell pushes and opens PRs) |
| herdr | `pgrep -af "herdr server"` | panes for Operators (start it if it is not running) |
| claude | `command -v claude` | runner `claude` (Line `standard` and `feature` use it) |
| cursor-agent | `command -v cursor-agent` | runner `cursor` (Line `feature`, plan-reviewer) |
| agy | `command -v agy` | runner `antigravity` (if the Line's doctor uses it) |

Which runners are needed depends on the Line: `standard` and `fast` use `claude` only, `feature` also uses `cursor` and, in this repo, `antigravity` for the doctor. Check `packages/factory-definitions/lines/*.yml`, `runner:` lines.

Each runner must be logged in. Ask the user to confirm this; do not try to log in for them.

## 2. Decide the values

Ask the user for these, and offer the defaults shown:

- `projects`: the project id to serve, for example `software-factory`.
- `repo`: the Git URL of that project's repository. Ask; do not assume one.
- `slots`: concurrent Jobs for this Cell. Default `1`.
- `runners`: the runners this Cell may start. Default: the ones the prerequisites found, from the Lines in use.
- `factory_data_dir`: where the server keeps its data and socket. Default `$HOME/.local/share/factory`.
- `cell_data_dir`: optional. Default `$HOME/.local/share/factory-cell`.
- `worktree_limit`: optional. Default `8`.

## 3. Write the Cell config

The Cell reads `${XDG_CONFIG_HOME:-$HOME/.config}/factory-cell/config.toml`. Write it with the values from step 2. Keep the keys exactly as the Cell parses them (`apps/cell/src/config.ts`), and do not add unknown keys: the parser refuses them.

```toml
slots = 1
projects = ["<project-id>"]
runners = ["claude"]
factory_data_dir = "<absolute path>"
```

If the file exists, back it up first and show the user the diff. Never overwrite a config the user has not seen.

## 4. Start the server and register the project

1. Start the server in its own terminal (it stays in the foreground): `pnpm factory-server`. Wait until it prints `listening on ...`.
2. Register the project, once: `pnpm factory project add <project-id> --repo <url>`. Check with `pnpm factory project ls`.
3. If the project's base branch is not `main`, set it: `pnpm factory project set <project-id> --base-branch <branch>`.

## 5. Start the Cell

In its own terminal: `pnpm factory-cell`. It must print `1 slot(s) running as <cell id>` (or the number of slots set). If it prints `no factory-server answers on ...`, the data directory in the config does not match the server's: fix `factory_data_dir`.

Do not set `XDG_CONFIG_HOME` to point somewhere else for the Cell. Herdr finds its socket under that directory, so the Cell then cannot reach Herdr.

## 6. Verify intake

1. `pnpm factory sync`: it reads the todos on the project's base branch and prints how many Work orders it created.
2. `pnpm factory status`: each new Work order is listed with its status.
3. Only todos with `factory: v2` in their frontmatter become Work orders while `FACTORY_V2_ONLY` is unset (`docs/TRIAL.md`).

## 7. Report

Report to the user: the prerequisites found, the config path and what changed in it (with the backup path), the project registered, the server and Cell status, and the result of `sync` and `status`. Say what was not checked, for example the logins of the runners.

## Known limits (say so when relevant)

- No Mechanic yet: an Andon waits for the Supervisor. Resume with `pnpm factory resume <order>`, cancel with `pnpm factory cancel <order>`.
- Stopping a Cell with SIGTERM makes it hand its live Jobs over, which can take up to 5 minutes before the Job is released.
- A Work order's Line is fixed when it is created. A changed Line applies only to new Work orders.
