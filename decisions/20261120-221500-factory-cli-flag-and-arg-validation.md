---
scope: factory
summary: Reject unknown flags, empty flag values, bad numbers and stray positionals in every sf command
why: citty drops unknown flags, turns a valueless string flag into "", and Number() leaked NaN and raw Zod JSON; only operator guarded flags
date: 2026-11-20
tags: [cli, fix]
---

- `src/adapters/cli/validate.ts`: `assertValidArgs` checks `rawArgs` against a command's declared args (aliases, camel/kebab, `--no-x`, stops at `--`): `unknown option`, `<flag> requires a value`, `unexpected argument`. Unknown options reported before missing values.
- `src/cli.ts`: one preflight on the resolved command, so default-subcommand groups (`incident`, `queue`) report `unknown option --x` not `Unknown command x`. Exit `2`, one stderr line, no stack.
- `resolve-command.ts`: returns `rest` (tokens after the command path) and `argsOf`.
- Positional ids declared as `positional` args (`incident resolve`, `order *`, `project add`); `queue` actions variadic via `valueHint` ending `...`.
- `parseWholeNumber` / `parsePort` / `requiredPositional` replace `Number(...)` and `String(args._[0] ?? '')`: `--max-running` >= 1, `--port` and `FACTORY_PORT` 1-65535, `--after` >= 0.
- `runWithoutToken` accepts a ports builder, so `buildContext()` in `init`, `server`, `web` runs inside `settle`.
- `project`, `server`, `todos`, `token` import `reportFailure` from `output.ts`.
- `operator.command.ts`: local `assertKnownFlags` removed; shared preflight covers it, `operator-verbs.test.ts` unchanged and green.
- Tests: `test/unit/adapters/cli-validation.test.ts`, `test/blackbox/cli-validation.test.ts` (all groups, zero HTTP hits, zero files written).
