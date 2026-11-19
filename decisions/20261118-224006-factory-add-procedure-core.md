---
scope: factory
summary: Add procedure access core and ports to factory CLI
why: Every command must pass one access rule, and tests need fake ports so no real server, git or runner is required.
date: 2026-11-18
tags: [factory, cli, procedures, ports]
---

- New `application/core/procedure.ts`: `define(access)(schema)(handler)` returns `{ access, parse, execute }`. `execute` runs authorize, then parse, then handler.
- `authorize` is the only access check: supervisor needs supervisor token, cell needs same `cellId`, job needs same `jobId`, `role`, `epoch`. Failure throws `Refused`.
- Single cast in `checkAccess`, only after authorize passes. Handler never runs when authorize fails.
- `execute` takes raw input, not parsed input. Parse runs after authorize, so a refused caller learns nothing about argument shape.
- Bad argument throws `ArgumentError` (exit 2). Refusal throws `Refused` (exit 1). `Unreachable` is defined (exit 3), not yet thrown.
- New `domain/access.ts`: `Access` union shared by procedures and ports. Keeps ports from importing the procedure module.
- Ports as interfaces only: server, fs, token store, operator endpoint, runner, git, process, clock. No adapters yet.
- `bootstrap/context.ts` `buildContext()`: stub port set, every method throws `port not wired`. Mode parameter deferred until adapters differ per mode.
- `bootstrap/run.ts` `run(procedure, input, mode, build?)`: reads token from token store, executes, maps `Refused`/`ArgumentError`/`Unreachable` to exit codes. Missing token is a refusal. Other errors rethrow.
- Boundary test: `application/` imports no adapter, bootstrap or Node built-in module.
- Unit tests: 64 pass across 13 files, including cell/job/supervisor refusals, handler not run on refusal, and exit mapping 1 and 2.
