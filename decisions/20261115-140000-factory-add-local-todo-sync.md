---
scope: factory/cli
summary: Sync the board from the local todos folder
why: Todos should reach the Factory without a commit, push or PR, and the board should match the folder
date: 2026-11-15
tags: [v2, intake, cli, cell]
---

- `factory sync` sends `./todos` (or `--dir`) and replaces the project's board; `--git` keeps the old base-branch intake.
- Replace cancels every unfinished Work order whose todo is not in the folder, claimed or not.
- The git intake timer is off by default; `FACTORY_INTAKE_POLL_MS` turns it back on.
- Several Cells run on one machine through instance directories (`instance-lock.ts`), joining as `hostname-N`.
- Todos: passive-server plan (Drizzle, server as a pure store, CLI), `cell-single-order`; perf todos drop slot work.
