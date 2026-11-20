---
scope: factory
summary: Show root usage when sf runs with no arguments
why: Bare sf threw CLIError E_NO_COMMAND with a stack trace and exit 2 instead of helping the user
date: 2026-11-20
tags: [cli, fix]
---

- `src/cli.ts`: empty `rawArgs` handled like `--help` / `-h`: print root usage, exit `0`.
- `test/blackbox/cli-help.test.ts`: no-arg run prints usage naming `sf`, exits `0`, no `E_NO_COMMAND`.
- `run-job.procedure.ts`: main referenced undefined `CELL_LOG_PATH` / `CLI_ENTRY` (broke `check-types`); use `runtime.logPath` and `operatorCommandOf()`.
