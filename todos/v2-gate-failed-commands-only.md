---
status: todo
priority: medium
depends_on:
  - v2-fix-inspection-tail-sanitization
workflow: feature
factory: v2
---

# v2-gate-failed-commands-only: report failed gate commands without sending output

## Objective

Stop sending raw inspection command output in `ReportInspection.tail` and `gate-feedback` retry prompts. Instead, report only which gate commands failed (or timed out) and instruct the `build` Operator to run those commands in its worktree, inspect any errors, and fix them (while still storing each check's full `logBlob` for human/supervisor inspection).

## Read first

- `apps/cell/src/jobs/run-inspection.ts` (`runChecks`, `ReportInspection`)
- `apps/cell/src/__tests__/run-inspection.test.ts`
- `packages/factory-runtime/src/prompts/build-prompt.ts` (`feedback?.kind === 'inspection'`)
- `packages/factory-runtime/src/prompts/__tests__/prompts.test.ts` and `__snapshots__/prompts.test.ts.snap`
- `packages/factory-definitions/templates/prompts/gate-feedback.md` and `packages/factory-definitions/src/templates.ts`

## Deliverables

1. **No raw output in `ReportInspection.tail` (`apps/cell/src/jobs/run-inspection.ts`):**
   - Replace raw command output in `results[i].tail` with a short, machine-independent status summary (`'passed'`, `'timed out'`, or `'failed (exit <code>)'`), never forwarding command stdout/stderr into the event store.
   - Continue uploading the full command output via `putLog` as `logBlob` so audit/debugging blobs remain available.
2. **Failed-command-only gate feedback (`packages/factory-runtime/src/prompts/build-prompt.ts` & `packages/factory-definitions/templates/prompts/gate-feedback.md`):**
   - When `feedback.kind === 'inspection'`, include only commands where `result.exitCode !== 0 || result.timedOut`.
   - Do not inline raw command output from `result.logBlob` into the `build` prompt; instead render a concise instruction telling the Operator that the command did not pass and to run it in the worktree, inspect the errors, and fix them (keeping `templates.ts` placeholder validation intact across definition fixtures).
3. **Tests & snapshots (`RULES §6.3`):**
   - Update `apps/cell/src/__tests__/run-inspection.test.ts` to assert `ReportInspection.results[].tail` contains only the machine-independent status string (no stdout/stderr) while `logBlob` still holds the full output.
   - Update `packages/factory-runtime/src/prompts/__tests__/prompts.test.ts` (and snapshot if affected) to assert passing gate commands are omitted, raw log output is not injected into `build` prompts, and failing commands are listed with instructions to run and fix them.
4. **ADR:**
   - One `decisions/` entry recording the change.

## Acceptance criteria

- [ ] `pnpm --filter @repo/factory-cell test`, `pnpm --filter @repo/factory-runtime test`, and `pnpm --filter @repo/factory-definitions test` pass.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test`, and `pnpm format:check` pass.
