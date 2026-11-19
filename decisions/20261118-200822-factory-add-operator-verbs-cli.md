---
scope: factory/operator-verbs
summary: Add operator verbs done, verdict and block
why: Operator agent needs finish, verdict and block verbs; server decides transitions, CLI sends verb and files only.
date: 2026-11-18
tags: [factory, operator, cli, verbs]
---

- `verbs/operator/done.ts`: `done` takes no options, sends `{ verb: 'done' }`.
- `verbs/operator/verdict.ts`: one `verdict` verb dispatching on subcommand `pass` or `fail`.
  - `cli.ts` routes on one word, so multi-word names need no `cli.ts` change.
  - `fail` requires `--feedback <file>`; `pass` takes no options.
  - Missing or unknown subcommand: exit 2, sent nothing.
- `verbs/operator/block.ts`: `block` requires `--reason` (non-empty) and `--handover <file>`; handover text sent as is, empty file allowed.
- `context` not built: PLAN §8 item 2 still open.
- `cli.ts` registry stays empty; wiring the verbs into the CLI is a later step.
- Tests: `__tests__/verbs-operator.test.ts`, 11 black-box cases through `runCli` and the stub Cell. Package total 55 pass.
- Gate: check-types, lint, test, format:check green. `nitpick:check` fails on decision-log count: 3 earlier entries already on branch.
