---
status: todo
priority: high
workflow: feature
factory: v2
---

# v2-fix-inspection-tail-sanitization: sanitize machine-local values in Cell tails

## Objective

Prevent `ReportInspection`, `FailCycle`, `ReportDelivery`, and `ReportPlanJobFailed` from failing `tailText` / `freeText` validation (`tail must not contain machine-local values`) when command output includes Cell paths, home paths, `localhost`, `host:port`, or process/pane identifiers.

## Read first

- `packages/factory-core/src/machine-local.ts`
- `packages/factory-core/src/order/events.ts` (`tailText`, `freeText`)
- `apps/cell/src/jobs/send.ts` (`tailOf`)
- `apps/cell/src/jobs/run-inspection.ts` (`runChecks`)
- `apps/cell/src/jobs/workspace-detail.ts` (`workspaceDetailOf`)
- `apps/cell/src/jobs/deliver.ts` (`tailOfRun`), `apps/cell/src/jobs/plan.ts` (`tailOfRun`)

## Deliverables

1. **Sanitize tails and error details in `apps/cell`:**
   - Redact machine-local tokens (`isMachineIndependentText` patterns from `@repo/factory-core/machine-local`: absolute paths, `~/`, Windows drive paths, `.local`/`.lan`/`.internal`/`localhost`, `host:port`, `pid=`, pane ids) inside `tailOf` (`apps/cell/src/jobs/send.ts`) and ensure `tail` always passes `isMachineIndependentText` and stays within 2 KiB UTF-8 (full unsanitized logs remain in `logBlob`).
   - Also sanitize `tailOfRun` / `errorText` in `apps/cell/src/jobs/deliver.ts`, `apps/cell/src/jobs/plan.ts`, and `apps/cell/src/jobs/run-inspection.ts` so failure details never throw `ZodError` on `freeText`.
2. **Tests (`RULES §6.3`):**
   - Unit tests proving `tailOf` and `runInspection` succeed and pass `ROUTES.submitCommand.request` when command output ends with `/home/factory/.local/share/factory-cell/worktrees/...`, `/tmp/foo`, `~/dir`, `localhost:3000`, `127.0.0.1:7878`, and `pid=1234`.
3. **ADR:**
   - One `decisions/` entry recording the change.

## Acceptance criteria

- [ ] `pnpm --filter @repo/factory-cell check-types`, `lint`, and `test` pass.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test`, and `pnpm format:check` pass.
