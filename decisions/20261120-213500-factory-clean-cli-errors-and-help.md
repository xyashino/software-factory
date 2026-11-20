---
scope: factory
summary: Clean sf CLI errors and resolve nested subcommand help
why: Unknown commands and runtime errors leaked stack traces, and --help always printed root usage
date: 2026-11-20
tags: [cli, fix]
---

- `src/adapters/cli/resolve-command.ts`: walks `rawArgs` to the deepest subcommand, skipping value flags, stopping at `--` or an unknown token.
- `src/cli.ts`: `--help` / `-h` before `--` prints the resolved command usage, exit `0`; root usage kept for no args.
- `src/cli.ts`: `dispatchInternal` and `runCommand` share one try/catch, no `console.error(error)`.
- `CLIError`: resolved usage plus clean message, exit `2`. `Refused` exit `1`, `Unreachable` exit `3`, any other error message only, exit `2`.
- `test/blackbox/cli-errors.test.ts`: unknown, bare and missing-flag cases across groups assert exit `2`, usage, no stack markers.
- `test/blackbox/cli-help.test.ts`: nested `--help` shows own usage.
