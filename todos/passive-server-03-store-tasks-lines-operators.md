---
status: todo
priority: high
depends_on: [passive-server-02-drizzle-stores]
line: feature
factory: v2
plan: passive-server
---

# passive-server-03: Repo-local .factory/ config, Cell rendering, and server task API

## Objective

Keep `factory-server` strictly for **tasks and state** (Work orders, Order Plans, events, leases, blobs, PR state). Move repository-specific definitions (`lines/`, `operators/`, `templates/prompts/`, `templates/pr/`) out of `packages/factory-definitions/` into a per-repo `.factory/` directory at the repository root (alongside `.nitpick/` for `rules` and `skills`). The Cell (`factory-cell`), running in/for the repository, reads `.factory/` and `.nitpick/` from the repository/worktree to render prompts and PR bodies and run stations, while `packages/factory-definitions/` keeps only schemas, validators, starter templates, and `templates/runtime/`. Add API routes so Work orders and Order Plans are created with a pinned `LineSnapshot` instead of the server loading definitions from disk.

## Read first

- `docs/PLAN.md`, `docs/CORE.md` (Line snapshot pinning), `docs/PROTOCOL.md` (§1, §3, §4, §8.3), `docs/STORAGE.md`
- `packages/factory-definitions/src/load.ts`, `line-schema.ts`, `line-validate.ts`, `line-snapshot.ts`, `operator-profile.ts`, `templates.ts`, `nitpick-catalog.ts`
- `packages/factory-core/src/contracts/routes.ts`, `http-routes.ts`, `supervisor.ts`, `job.ts`, `line/snapshot.ts`
- `packages/factory-core/src/order/commands.ts`, `events.ts`, `decide-lifecycle.ts`; `plan/commands.ts`
- `packages/factory-runtime/src/open-runtime.ts`, `ports.ts`, `job-builder.ts`, `prompts/build-prompt.ts`, `prompts/incident-prompt.ts`, `pr-body.ts`, `paths.ts`
- `apps/cell/src/jobs/run-operator-station.ts`, `run-mechanic.ts`, `deliver.ts`, `config.ts`

## Deliverables

1. **Per-repo `.factory/` directory and `factory-definitions` split:**
   - Move `software-factory`'s own `lines/`, `operators/`, `templates/prompts/`, and `templates/pr/` from `packages/factory-definitions/` into `.factory/` at the repository root.
   - `packages/factory-definitions/` retains: schemas (`schemas/line.schema.json`), parsers/validators (`line-schema`, `line-validate`, `line-snapshot`, `operator-profile`, `templates`, `nitpick-catalog`, `load`), starter scaffold assets (for `factory init` in `passive-server-05`), and `templates/runtime/` (the Cell↔Operator protocol prompts).
   - Add a repo loader helper in `factory-definitions` (e.g. `loadRepoDefinitions(repoRoot)`) that reads `<repoRoot>/.factory/` and validates `rules`/`skills` against `<repoRoot>/.nitpick/` when present.
2. **Task & PR-state API (`packages/factory-core`, `packages/factory-runtime`, `apps/server`):**
   - Routes under `auth: 'supervisor'`, each idempotent by `commandId`:
     - `POST /v1/orders` (`createOrder`: `projectId`, `todoId`, `title`, `type`, `body` markdown spec, `line` as a validated `LineSnapshot`, `priority`, `dependsOn`, optional `plan`, optional `baseBranch`).
     - `POST /v1/plans` (`createPlan`: `projectId`, `slug`, optional `baseBranch`, ordered members with `LineSnapshot` validated as a linear chain).
     - `POST /v1/orders/:id/pr-state` (`recordPrState`: `open | merged | closed`) and the plan equivalent.
   - `createOrder` / `createPlan` store the spec body as a blob, compute `contentHash`, pin the provided `LineSnapshot` on the order, and append through `CommandHandler`, waking waiting Cells. No `lines`, `operators`, or repo `templates` tables are added to the server DB.
   - `deliver.removeTodo` becomes optional in `jobSchema`; API-created orders omit it and `apps/cell/src/jobs/deliver.ts` skips deleting a todo file when absent.
3. **Cell-side prompt & PR rendering (`packages/factory-core`, `packages/factory-runtime`, `apps/cell`):**
   - Remove server-side rendering of repo `operators/`, `templates/prompts/`, and `templates/pr/` from `job-builder.ts`; `jobSchema` carries structured job inputs/metadata (station, operator profile/runner/model/permission, cycle context, input/feedback blob refs, budget, order spec blob, delivery commit/report refs) plus server protocol `runtimePrompts`.
   - `apps/cell` loads `.factory/` (and `.nitpick/`) from the repository worktree (or Cell repo cwd) to resolve the Operator profile, declared rules/skills, prompt templates (`templates/prompts/`), and PR templates (`templates/pr/`), rendering Cycle/Mechanic prompts and PR markdown bodies on the Cell.
   - Keep `buildPrompt` / `buildIncidentPrompt` / `formatPrBody` validation strict: missing templates or invalid `.factory/` in the target repo fail the job cleanly with an actionable diagnostic.
4. **Tests:**
   - Contract tests for `createOrder`, `createPlan`, `recordPrState` (validation, idempotency, pinned `LineSnapshot` without server-side definition files).
   - Cell tests verifying two repositories with distinct `.factory/` configs (`lines`, `operators`, `templates/pr`, `.nitpick`) run against the same `factory-server` without sharing templates or definitions on the server.
   - End-to-end delivery of an API-created order with no `todos/*.md` in the repository.
5. **Docs:** `docs/PLAN.md` (server owns tasks & state; each repo owns `.factory/` + `.nitpick/`), `docs/PROTOCOL.md` route and job payload tables.

## Acceptance criteria

- [ ] `software-factory` uses its own root `.factory/` (`lines/`, `operators/`, `templates/prompts/`, `templates/pr/`) alongside `.nitpick/`, and `packages/factory-definitions/` no longer holds repo-specific workflow/PR templates as server runtime input.
- [ ] A Work order and an Order Plan created via `createOrder` / `createPlan` with a `LineSnapshot` are claimed, executed (prompts and PR body rendered by the Cell from the repo's `.factory/`), and delivered with no `todos/*.md` in the repository.
- [ ] Two projects with different `.factory/` templates/operators/lines work against one `factory-server`.
- [ ] `pnpm ci:verify` passes.
