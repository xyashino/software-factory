---
scope: repo/cell-contracts
summary: Add cell-contracts package with cell wire contracts and enums
why: cell contracts lived in the cell app; sf needs them as a package to type against
date: 2026-11-22
tags: [contracts, cell, zod]
---

- `packages/cell-contracts`: `@repo/cell-contracts`, subpath exports `./*` to `src/*.ts`, no barrel.
- Contracts moved with `git mv` from `apps/cell/src/contracts/`: `cells`, `factories`, `health`, `settings`, `stream`.
- `enums/cells`: `RUNTIME_STATUSES`. `enums/settings`: `RUNNERS`. Each defined once; cell domain imports them, logic stays.
- `cells.contract` `runtimeStatus` uses `RUNTIME_STATUSES`; wire values and order unchanged.
- `errorResponse` comes from `@repo/zod-contract-kit/reply`; `apps/cell/src/contracts/` deleted; 14 importers switched.
- Cell lint: legacy `@repo/cell-*` guard excludes `@repo/cell-contracts`; dead `src/contracts/**` rule removed.
- Tests: `parseReply` stories for health, settings and cells replies.
- Cell blackbox tests pass with no assertion changes.
- Left as is: `desiredState` enum inline in cells contract (`DESIRED_STATES` in cell domain).
- Found: sf `adapters/runners/registry.ts` keeps a second list of the same five runner names as `RUNNERS`; not changed.
