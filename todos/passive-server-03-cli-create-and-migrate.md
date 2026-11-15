---
status: todo
priority: high
depends_on: [passive-server-02-passive-mode-webhooks]
line: feature
factory: v2
plan: passive-server
---

# passive-server-03: CLI order creation and todos folder migration

## Objective

Add `apps/cli` commands to create Work orders and Order Plans directly on `factory-server`, update PR state manually, and migrate an existing `todos/` directory of markdown files to the server over the API.

## Read first

- `apps/cli/src/cli.ts`, `context.ts`, `commands/project.ts`, `commands/plan.ts`, `commands/sync.ts`
- `packages/factory-definitions/src/todo.ts`, `todo-scan.ts`, `todo-plan.ts`
- `packages/factory-core/src/contracts/supervisor.ts`, `routes.ts`

## Deliverables

1. **CLI order & plan commands (`apps/cli`):**
   - Add `factory order create` accepting `--project <id>`, `--todo-id <slug>`, `--title <text>`, `--type <feat|fix|chore|...>`, `--line <name>`, `--priority <high|medium|low>`, `--plan <slug>`, `--depends-on <id,...>`, `--base-branch <branch>`, and spec markdown via `--file <path>`, `--body <text>`, or stdin (`-`).
   - Add `factory order pr-state <orderId> <open|merged|closed>` calling `recordPrState`.
   - Add `factory plan create --project <id> --slug <slug> [--base-branch <branch>] --members <json-or-files...>` calling `createPlan`.
   - Work identically over both local Unix socket and remote HTTP (`FACTORY_URL` + `FACTORY_TOKEN`).
2. **Migration command `factory todos migrate` (`apps/cli`):**
   - Scan a local directory (default `./todos`) using `@repo/factory-definitions` (`scanTodos`, `validatePlans`).
   - Support `--project <id>` (required if multiple projects exist), `--dir <path>`, `--dry-run`, `--all` (include non-v2 todos), and `--remove` (optionally delete migrated `.md` files only after server confirmation).
   - Topologically order standalone todos and send each valid `plan` via `createPlan` and each standalone todo via `createOrder`, reusing deterministic `commandId`s so re-running is idempotent and already-existing `OrderId`s are reported as `skipped`.
   - Print a structured summary (`created`, `skipped`, `diagnostics` / `errors`) with `--json` support.
3. **Tests:**
   - CLI black-box tests covering `factory order create` (file/body/stdin), `factory order pr-state`, `factory plan create`, and `factory todos migrate` (`--dry-run`, plan chains, dependency ordering, idempotent re-run, and diagnostics on invalid files).

## Acceptance criteria

- [ ] `factory order create` and `factory plan create` enqueue Work orders and Order Plans on a passive remote `factory-server` without touching git.
- [ ] `factory todos migrate todos/` validates and imports existing `todos/*.md` (including stacked Order Plans and `depends_on`) idempotently into `factory-server`.
- [ ] `pnpm ci:verify` passes.
