---
scope: factory/operator-verb-pipeline
summary: Add defineVerb pipeline and citty CLI shell
why: Every verb shares one pipeline; cli.ts registers verbs by explicit import, no barrel.
date: 2026-11-18
tags: [factory, operator, cli, verbs]
---

- `verbs/define-verb.ts`: `defineVerb({ name, description, args, readFiles, toRequest })` returns a verb with `run(argv, io)` and `options` for usage.
- Pipeline: parse flags with `node:util` `parseArgs` (strict, no positionals).
  - Then validate values with the verb's zod `args`.
  - Then read every file in `readFiles`, `toRequest(args, files)`, `sendRequest`.
  - Print via `lineFor`, return `exitCodeFor`.
- Syntactic checks only: unknown option, missing required flag, bad enum value, missing required file, unreadable file: exit 2, sent nothing. No Line or job-state checks.
- Flags are kebab-case of camelCase keys (`reasonText` -> `--reason-text`). Only string-valued flags: `z.string()` and `z.enum`.
- Ok line goes to stdout; refused, argument and unreachable lines go to stderr. Exit code unchanged either way.
- `cli.ts`: `runCli(argv, io, verbs)` on citty root command with one subcommand per verb. `--help`, `-h` or no args print usage, exit 0. Unknown verb: exit 2, sent nothing.
- `cli.ts` registers verbs by explicit import. Registry is empty in this step; real verbs come in later steps.
- `usage.ts`: pure `usage(program, verbs)` built from verb specs, no hand-copied list.
- `io` (env, stdout, stderr) is injected, so tests run the real pipeline against the stub Cell without spies.
- Bin guard `import.meta.main` keeps tests from starting the CLI on import.
- Tests: 44 pass in `@repo/operator` (define-verb pipeline and CLI black-box, exit 0, 1, 2 and 3 covered). Output in `.cell/steps/build/evidence`, not committed.
- Gate: check-types, lint, test, format:check green. `nitpick:check` fails only on decision-log count: branch commits `ab7a967` and `2fd503f` already each add one entry.
