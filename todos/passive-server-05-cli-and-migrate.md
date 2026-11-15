---
status: todo
priority: high
depends_on: [passive-server-04-pure-store-server]
line: feature
factory: v2
plan: passive-server
---

# passive-server-05: CLI for repo .factory/ init/check, task API, and todos/ migration

## Objective

Give the Supervisor CLI (`apps/cli`) and Cell (`apps/cell`) the tooling for repo-owned `.factory/` workflows and the pure-state server: initialize and validate `<repo>/.factory/` (alongside `.nitpick/`), create Work orders and Order Plans against the server using the repo's local `.factory/lines/`, set PR state by hand, migrate an existing `todos/` folder into the server once, and support launching `factory-cell` inside a repository with repo-local config.

## Read first

- `apps/cli/src/cli.ts`, `context.ts`, `commands/project.ts`, `commands/plan.ts`
- `apps/cell/src/main.ts`, `config.ts`
- `packages/factory-definitions/src/todo.ts`, `todo-scan.ts`, `todo-plan.ts`, `load.ts`, `line-snapshot.ts`
- `packages/factory-core/src/contracts/supervisor.ts`, `routes.ts`
- `docs/PROTOCOL.md` (CLI table)

## Deliverables

1. **Repo `.factory/` CLI commands:**
   - `factory init [--dir <repoRoot>] [--force]` scaffolds `<repoRoot>/.factory/` (`lines/`, `operators/`, `templates/prompts/`, `templates/pr/`) from the starter templates in `packages/factory-definitions`.
   - `factory check [--dir <repoRoot>]` validates `<repoRoot>/.factory/` (Lines, Operators, prompt & PR templates) and cross-checks declared rules/skills against `<repoRoot>/.nitpick/` if present, printing diagnostics per file.
2. **Task commands (`apps/cli`):**
   - `factory order create --project <id> --todo-id <slug> --title <text> --type <feat|fix|chore|…> --line <name> [--repo-dir <path>] [--priority <high|medium|low>] [--plan <slug>] [--depends-on <id,…>] [--base-branch <branch>]` reads and validates `--line <name>` from `<repoDir>/.factory/lines/<name>.yml` (defaulting `--repo-dir` to `cwd`), computes its `LineSnapshot`, and sends `createOrder` with the spec from `--file <path>`, `--body <text>`, or stdin (`-`).
   - `factory plan create --project <id> --slug <slug> [--repo-dir <path>] [--base-branch <branch>] --members <files…>` reads each member's line from `<repoDir>/.factory/lines/` and sends `createPlan`.
   - `factory order pr-state <orderId> <open|merged|closed>` (fallback when no webhook is configured).
3. **One-time `todos/` migration:**
   - `factory todos migrate [--dir ./todos] [--repo-dir .] --project <id> [--dry-run] [--all] [--remove]` scans with `scanTodos` / `validatePlans` using `<repoDir>/.factory/lines/`, creates plans via `createPlan` and standalone todos via `createOrder` in dependency order with deterministic `commandId`s so re-running is idempotent (`skipped` for existing ids), and deletes files only with `--remove` after the server confirms.
4. **Repo-scoped `factory-cell` config support (`apps/cell`):**
   - Allow `factory-cell` launched inside a repository root (e.g. via `.factory/cell.toml` or `--repo-dir` / `cwd` discovery, with `~/.config/factory-cell/config.toml` as fallback/override) so running a Cell in a repo picks up that repo's config, agents, rules, and `.factory/` definitions cleanly.
5. All CLI commands work over the local socket and remote HTTP (`FACTORY_URL` + `FACTORY_TOKEN`), and support `--json`.
6. **Tests & Docs:**
   - CLI black-box tests for `init`, `check`, `order create`, `plan create`, `order pr-state`, `todos migrate` (stdin, plan chains, dependency ordering, idempotent re-runs, `--dry-run`, invalid `.factory/` diagnostics).
   - `apps/cell` config discovery tests for repo-local `.factory/`.
   - Update `docs/PROTOCOL.md` CLI table and the root `README.md` setup guide (`factory init` in repo, start `factory-server`, run `factory-cell` in repo, `factory order create` / `factory todos migrate`).

## Acceptance criteria

- [ ] A new repository can be bootstrapped with `factory init` + `factory check`, run with `factory-cell` inside that repo, and accept tasks via `factory order create` against a pure-state `factory-server`.
- [ ] `factory todos migrate todos/` imports existing todos (with `LineSnapshot` resolved from `.factory/lines/`), including stacked Order Plans and `depends_on`, idempotently.
- [ ] `pnpm ci:verify` passes.
