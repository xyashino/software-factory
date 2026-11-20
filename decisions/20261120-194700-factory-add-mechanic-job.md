---
scope: factory
summary: Add read-only mechanic job that resolves incidents in factory
why: Lines declared no runnable mechanic; apps/factory refused operator read and incident verbs
date: 2026-11-20
tags: [v2, factory, mechanic, incident, cell]
---

- `.factory/operators/mechanic.md`: read-only triage profile, `rules: []`, `skills: [caveman]`, `artifacts: report`.
- `feature`, `standard`, `fast` lines: `mechanic:` block (antigravity, gemini-3.8-flash-medium, 20m, headless false, permission read).
- `lineFileSchema` and `line.schema.json` accept `mechanic`; `validateLine` checks its profile exists.
- apps/factory `parseLine` returns `mechanic` (profile, runner, model, timeoutMs, headless default true, permission default read) or null when incomplete; `mechanicTimeoutMs` unchanged.
- factory-server: claim carries `incidentId`; `start` on a mechanic job sets running without touching order steps or `job.stepId`.
- Cell `runJob` branches on `job.kind === 'mechanic'`: start, prepare worktree if missing, write `.cell/mechanic/prompt.md`, run runner with line permission.
- `factory-operator read` served inline as `{incident, steps, logs}`; loop continues.
- `factory-operator incident` ends the run, writes `.cell/mechanic/report.md`, calls `POST /api/v1/incidents/:id/resolve` with `action`, `stepIndex` (from `--step`, checked against line stations) and `epoch`.
- Runner exit or timeout before a resolution fails the mechanic job; any other verb is refused with 400.
- Action vocabulary is the server resolve body: retry_step, restart_from_step, restart_from_scratch, escalate, cancel.
- Resolve body has no report field: diagnosis, tried and report stay in `.cell/mechanic/report.md` only.
- Left as-is: `apps/cell` mechanic (`run-mechanic.ts`, `run-job.ts` mechanic case, `operator.ts` resume/repair/nudge). Different design, flagged for later cleanup.
- Checks: `pnpm ci:verify` green (51/51 tasks); factory-definitions, factory-server and apps/factory test suites pass; new tests in `run-mechanic-job.test.ts`.
