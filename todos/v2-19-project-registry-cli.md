---
status: todo
priority: medium
depends_on: []
workflow: feature
---

# v2-19: Project registry CLI

## Objective

Replace manual `seedProject` calls with a first-class project registry: register, list, update and
remove projects (`projectId`, `repoUrl`, `baseBranch`, `maxRunning`, `depPolicy`) through the
Supervisor CLI, in local socket, remote HTTP and `--once` modes alike.

## Read first

- `docs/STORAGE.md` §1, §4 (`projects` table), §7 (export includes `projects.jsonl`)
- `docs/PROTOCOL.md` §3.0, §3.1, §10
- `docs/RULES.md` §2.6, §4.7, §6.1, §6.2, §6.5
- `packages/factory-core/src/ports/projects.ts`
- `packages/factory-db/src/projects-table.ts`, `packages/factory-db/src/schema.ts` (`orders.project_id` FK)
- `packages/factory-runtime/src/seed.ts`, `packages/factory-runtime/src/job-builder.ts` (`project.baseBranch` read per job)
- `apps/cli/src/client/once.ts`, `apps/cli/src/usage.ts`, `apps/cell/src/config.ts` (`projects` a Cell serves)

## Deliverables

1. **Docs first:**
   - PROTOCOL §3.1: routes `GET /v1/projects`, `POST /v1/projects`, `POST /v1/projects/:id`,
     `DELETE /v1/projects/:id` and their socket paths (`supervisor/projects`, `…/add`, `…/set`, `…/remove`).
   - PROTOCOL §10: `factory project ls | add | set | rm`.
   - STORAGE §4: `projects` is mutable configuration, not an event stream; changes are not in any
     Traveler; it is part of export/import.
   - `decisions/` entry.
2. **Core (`packages/factory-core`):**
   - `ProjectStore`: `add(project)`, `set(projectId, patch)`, `remove(projectId)`.
   - zod schemas in `contracts/supervisor.ts` and `ROUTES` entries `projectList`, `projectAdd`,
     `projectSet`, `projectRemove` in `contracts/routes.ts`. `projectId` uses `projectIdSchema`;
     `maxRunning` is a positive int; `depPolicy` is `delivered | merged`.
   - In-memory fake in `factory-core/testing` and a shared `ProjectStore` contract suite (RULES §6.2).
3. **Storage (`packages/factory-db`):** `sqliteProjectStore` implements `add` / `set` / `remove`
   under `writer.assertHeld()` and `gate.run(...)`.
   - `add` refuses an existing `projectId` (`precondition`).
   - `remove` refuses while the project has any Work order, event or `intake` row. A project with
     history is never deleted (projections must stay rebuildable).
   - `set` refuses a `baseBranch` change while the project has a non-terminal Work order (running
     orders must not switch base; v2-21 pins the base per Work order).
   - `repoUrl` is not changeable via `set` (mirror and Cell checkouts would go stale): remove and re-add.
4. **Runtime and server (`packages/factory-runtime`, `apps/server`):** the four operations in
   `operations.ts` under the writer lock, served over the socket and over HTTP. `seedProject` gains an
   optional `depPolicy` and its comment no longer points at intake v2-10.
5. **CLI (`apps/cli`):**
   - `factory project ls`
   - `factory project add <id> --repo <url> [--base-branch <b>] [--dep-policy delivered|merged] [--max-running <n>]`
   - `factory project set <id> [--base-branch <b>] [--dep-policy delivered|merged] [--max-running <n>]`
   - `factory project rm <id>`
   - Global `--json` and the existing `--once` fallback work unchanged (they already exist; only routes
     are added). `usage.ts` and CLI tests updated.

## Out of scope

- Order Plans (`v2-20` … `v2-23`).
- Changing `repoUrl` in place.

## Acceptance criteria

- A fresh data directory can register a project with `factory project add` alone, no SQLite access.
- Local socket, remote HTTP and `--once` run equivalent scenarios with equivalent results (RULES §6.5).
- `remove` with history and `set --base-branch` with a running Work order are refused with a clear
  `precondition`.
- Docs list that a newly added project is served only by Cells whose config lists it.
- `pnpm turbo check-types lint test` green.
