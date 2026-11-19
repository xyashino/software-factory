---
scope: factory/operator-mechanic-verbs
summary: Add Mechanic verbs read and incident
why: Mechanic agent needs read and incident; server decides transitions, CLI sends action, step, text and report file only.
date: 2026-11-18
tags: [factory, operator, cli, verbs, mechanic]
---

- `verbs/mechanic/read.ts`: `read` takes no options, sends `{ verb: 'read' }` only.
- `verbs/mechanic/incident.ts`: `incident` takes `--action` (zod enum of `INCIDENT_ACTIONS`, imported from protocol, not retyped) and `--report <file>` (required, UTF-8 text sent as is).
  - `--step` required only for `restart_from_step`; presence check only, step validity is the server's job.
  - `--diagnosis` and `--outcome` passed through when given, never required (PLAN §3.2 does not say; protocol makes both optional).
  - `escalate` is `incident --action escalate`; no separate command.
- No `answer` verb: needs PLAN §8 item 1 (question entity) first.
- `cli.ts` registry stays empty; wiring the mechanic verbs into the CLI is a later step.
- Tests: `__tests__/verbs-mechanic.test.ts`, 11 black-box cases through `runCli` and the stub Cell. Package total 66 pass.
- Gate: check-types, lint, test, format:check green on `apps/operator`.
