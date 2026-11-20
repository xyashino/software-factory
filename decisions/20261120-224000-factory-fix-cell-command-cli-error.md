---
scope: factory
summary: Resolve cell command conflict with CLIError pattern
why: main 7b94d80 routes CLIError-named errors through clean exit; cell.command still printed directly
date: 2026-11-20
tags: [cli, conflict]
---

- Stack #183 rebased onto `main` (7b94d80) via `gh stack rebase`; no git conflicts reported.
- `cell.command.ts`: `printError` + `EXIT.argument` replaced by `throw cliError(...)`, matching `cli.ts` error boundary.
- Dropped unused `printError` import.
- `pnpm check-types`, `pnpm lint`, `pnpm test`, `pnpm format:check` pass.
