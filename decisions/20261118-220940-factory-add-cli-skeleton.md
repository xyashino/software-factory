---
scope: factory
summary: Add factory-2 skeleton package with config, branded ids and exit codes
why: The new factory CLI needs a buildable package and fixed shared shapes before any command or domain logic can land.
date: 2026-11-18
tags: [factory, cli, skeleton]
---

- New package `@repo/factory` at `apps/factory/`, bin `factory-2`, no subcommands yet.
- `--help` prints root help and exits 0. Unknown errors exit 2 (`EXIT.argument`).
- `config.ts`: timing and URL constants from factory-server PLAN 3.7; body cap 1 MiB.
- `domain/common`: branded `CellId`, `JobId`, `OrderId`, `IncidentId`, `PlanId`, `ProjectId` via `toX(raw)`; empty input throws.
- `domain/common/time.ts`: `EpochMs` type only. No clock in domain.
- `domain/exit-codes.ts`: `EXIT` (ok 0, refused 1, argument 2, unreachable 3) and `ExitCode`.
- Added `@types/bun` devDependency (needed by `bun --bun` and `bun build`); not in todo list.
- citty `runMain` exits 1 on errors, so `cli.ts` calls `showUsage` and `runCommand` directly to map errors to `EXIT`.
- Root command name stays `factory` per todo; bin is `factory-2` until cut-over.
- Tests: one black-box test spawns the entrypoint with `--help`. Config values not unit-tested (implementation detail).
