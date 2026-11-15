---
scope: factory/cell
summary: Gate reports and retry prompts name failed commands, not their output
why: Raw gate output in events and retry prompts is brittle, and the builder can re-run a failed command itself
date: 2026-11-15
tags: [cell, inspection, prompts, gate, tail]
---

- `apps/cell/src/jobs/run-inspection.ts` sends each check's `tail` as a status only: `passed`, `timed out`, or `failed (exit N)`.
  - Command stdout and stderr never reach `ReportInspection`.
  - The full output still goes to `putLog` as the check's `logBlob`, unchanged.
- `packages/factory-runtime/src/prompts/build-prompt.ts` renders a `gate-feedback` block only for checks with `exitCode !== 0` or `timedOut`.
  - Each block names the command and its status, and tells the Operator to run it in the worktree, read the errors, and fix them.
  - Inspection logs are no longer loaded into `blobTexts`, so no gate log text reaches a `build` prompt.
- `logTailChars` is removed from the runtime config and the prompt input. Nothing else read it.
- `gate-feedback` placeholders are now `command`, `status`, `retry`, `max`, checked against `packages/factory-definitions/src/templates.ts`.
- Tests:
  - `apps/cell/src/__tests__/run-inspection.test.ts` asserts the status tails and the full blob.
  - `packages/factory-runtime/src/prompts/__tests__/prompts.test.ts` asserts passing checks are omitted and no log text is inlined.
  - The prompt snapshot is unchanged.
