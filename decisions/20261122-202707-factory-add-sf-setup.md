---
scope: factory/sf
summary: "Add sf setup: doctor, init, server, project, cell"
why: fresh repo needed many manual steps before work started; setup runs them in one idempotent command
date: 2026-11-22
tags: [sf, setup, onboarding]
---

- `sf setup [--cell <name>] [--json]`: doctor, init, server, project, then cell. Each step `ran`, `skipped` or `failed`; stops at first `failed`.
- Re-run on a set-up repo: every step `skipped`, no spawn, no server write, exit 0.
- Doctor blocks on any `missing` check except `server`, `token`, `project` (setup fixes those) and `lines` while no repo config exists (init writes them).
- Doctor blocked: exit 4 (`EXIT.preflight`), no init, server start, project add or cell spawn.
- Doctor passing reports `skipped`: it changes nothing.
- Init runs only when `.factory/config.json` is missing; project id from origin name or dir name.
- Server start reuses `startServer`; token saved by it is read by later steps via `withSavedToken`, because ports snapshot the token at build time.
- Project add: id from repo config, repo url from `origin` (never printed: may carry credentials), base `main`, max running 5.
- No origin remote and project unregistered: project `failed`, fix `sf project add <id> --repo <repo-url>`.
- `--cell <name>`: `createLocalCells` count 1; `skipped` when a live local slot has that name. No cell unless flag given.
- Output: one line per step; `next: sf todos import --dry-run` only when ok. Tokens never printed.
- Exit: 0 ok, 4 doctor blocked, 2 refused otherwise (`EXIT.refused`).
- Fix: `isWritable` checks nearest existing ancestor; a missing data dir was reported unwritable by doctor.
- Verified: fresh temp repo, `sf setup` twice: run 1 init, server, project ran; run 2 all skipped, exit 0.
- Not done: probe accepts any listener on the port (known, out of scope).
- Not done: runner checks for template lines run only after init, so a fresh repo does not check them until the next doctor run.
- Not done: `--cell` covered by fake-port tests only, no real worker run here.
- Procedure `application/procedures/setup/setup.procedure.ts`; CLI `adapters/cli/setup.command.ts`; black box tests `test/unit/application/setup.test.ts`.
