---
status: todo
priority: high
depends_on: [passive-server-04-pure-store-server]
line: feature
factory: v2
plan: passive-server
---

# passive-server-05: CLI to create tasks, push Lines and Operators, and migrate todos/

## Objective

Give the Supervisor CLI (`apps/cli`) every write the server now owns: create Work orders and Order Plans, push Lines, Operators and templates, set PR state by hand, and import an existing `todos/` folder and `packages/factory-definitions/` into a server once.

## Read first

- `apps/cli/src/cli.ts`, `context.ts`, `commands/project.ts`, `commands/plan.ts`
- `packages/factory-definitions/src/todo.ts`, `todo-scan.ts`, `todo-plan.ts`, `load.ts`
- `packages/factory-core/src/contracts/supervisor.ts`, `routes.ts`
- `docs/PROTOCOL.md` (CLI table)

## Deliverables

1. **Task commands:**
   - `factory order create --project <id> --todo-id <slug> --title <text> --type <feat|fix|chore|…> --line <name> [--priority <high|medium|low>] [--plan <slug>] [--depends-on <id,…>] [--base-branch <branch>]` with the spec from `--file <path>`, `--body <text>` or stdin (`-`).
   - `factory plan create --project <id> --slug <slug> [--base-branch <branch>] --members <files…>`.
   - `factory order pr-state <orderId> <open|merged|closed>` (fallback when no webhook is configured).
2. **Definition commands:** `factory line push <file.yml…>`, `factory line ls`, `factory line show <name> [--version n]`; `factory operator push <file.md…>`, `factory operator ls`, `factory operator show <id>`; `factory template push <file…>`. Server-side validation errors are printed per file.
3. **One-time import:** `factory definitions import [--dir packages/factory-definitions]` pushes all Lines, Operators and templates (unchanged content is a no-op by `content_hash`). `factory todos migrate [--dir ./todos] --project <id> [--dry-run] [--all] [--remove]` scans with `scanTodos` / `validatePlans`, creates plans via `createPlan` and standalone todos via `createOrder` in dependency order, uses deterministic `commandId`s so re-running is idempotent (existing ids reported as `skipped`), deletes files only with `--remove` after the server confirms.
4. All commands work over the local socket and remote HTTP (`FACTORY_URL` + `FACTORY_TOKEN`), and support `--json`.
5. **Tests:** CLI black-box tests for each command, including stdin input, plan chains, dependency ordering, idempotent re-runs, `--dry-run`, and invalid files producing diagnostics.
6. **Docs:** `docs/PROTOCOL.md` CLI table and the root `README.md` usage section (setup = start server, `factory definitions import`, `factory todos migrate`).

## Acceptance criteria

- [ ] A fresh server becomes usable with `factory definitions import` followed by `factory order create` or `factory todos migrate`.
- [ ] `factory todos migrate todos/` imports existing todos, including stacked Order Plans and `depends_on`, idempotently.
- [ ] `pnpm ci:verify` passes.
