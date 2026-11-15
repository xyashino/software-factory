---
status: todo
priority: high
depends_on: [perf-01-unify-cell-workspace]
line: feature
factory: v2
---

# perf-02: Replace workspace.setup with declarative workflow changeover

## Objective

Rename `workspace.setup` to `changeover` across definitions, contracts, runtime, and Cell, driven purely by workflow YAML configuration with zero hardcoded tool/file/skip assumptions in the Cell or runtime.

## Read first

- `packages/factory-definitions/src/line-schema.ts`, `line-validate.ts`, `schemas/line.schema.json`
- `packages/factory-definitions/lines/fast.yml`, `standard.yml`, `feature.yml`
- `packages/factory-core/src/contracts/job.ts`, `packages/factory-core/src/order/events.ts`, `upcast.ts`
- `packages/factory-runtime/src/job-builder.ts`
- `apps/cell/src/workspace/prepare.ts`, `cache.ts`, `apps/cell/src/jobs/workspace-detail.ts`
- `docs/RULES.md`, `docs/CORE.md`, `docs/PROTOCOL.md`, `docs/STORAGE.md`

## Deliverables

1. **Workflow-driven `changeover` in `packages/factory-definitions`:**
   - Replace `workspace.setup` with optional `workspace.changeover` (`timeout`, `exec`, optional `keyFiles?: string[]` of repo-relative paths/globs whose git blob hashes determine cache invalidation).
   - Allow stations and `deliver` in `lines/*.yml` to opt out or override changeover declaratively in YAML (e.g. `changeover: false` on `plan`, `plan-review`, and `deliver` in `lines/{fast,standard,feature}.yml` where dependencies are not needed).
   - Update `line-schema.ts`, `schemas/line.schema.json`, and `shipped.test.ts` / `line-parse.test.ts`.
2. **Core contracts & event schema upcaster (`packages/factory-core`):**
   - Update `jobSchema` (`workspace.changeover: string[]`, optional `changeoverKeyFiles: string[]`) — no tool-specific fields.
   - Update `workspaceStageSchema` to use `'changeover'` instead of `'setup'`, bump `CURRENT_SCHEMA_VERSION` in `upcast.ts` (and `sqlite-event-store.ts`) with an upcaster mapping legacy `'setup'` `workspace_failed` events per `RULES.md §2.4`.
3. **Pure projection in `job-builder.ts` and agnostic Cell execution (`apps/cell`):**
   - `buildJob` in `packages/factory-runtime/src/job-builder.ts` resolves `workspace.changeover` and `changeoverKeyFiles` strictly from the Line definition for the target station / `deliver`.
   - Cell executes `job.workspace.changeover` as-is (skipping cleanly when empty) and computes the cache marker from the git hashes of `changeoverKeyFiles` at `<base>` when provided (falling back to `<base>` SHA only if `keyFiles` is omitted). Cell must contain zero hardcoded references to `pnpm`, `pnpm-lock.yaml`, `deliver`, or station names.
4. **Docs, tests & ADR:**
   - Update `docs/CORE.md`, `docs/PROTOCOL.md`, `docs/STORAGE.md`, `docs/ROADMAP.md` to match `changeover`.
   - Add unit/upcaster/contract tests and one `decisions/` ADR entry.

## Acceptance criteria

- [ ] `setup` in workspace preparation is replaced by `changeover` across `factory-definitions`, `factory-core`, `factory-runtime`, `apps/cell`, and `docs/`.
- [ ] All changeover behavior (which commands run, which stations/deliver skip it, and which files invalidate its cache) is defined solely in `lines/*.yml` and passed via `Job`.
- [ ] Legacy stored events with stage `'setup'` upcast cleanly without breaking read validation.
- [ ] `pnpm ci:verify` passes.
