---
scope: factory/trial
summary: Add todo to clear echoed command in Cell logs tab
why: v2 logs tab echoed the full bun cli log command and prompt instead of clearing screen and scrollback like v1
date: 2026-11-15
tags: [v2, trial, feature, cell, herdr, logs]
---

- Add `todos/v2-clean-logs-tab.md` (`factory: v2`, `workflow: feature`, `priority: low`) to wrap the `logs` pane launch in `apps/cell/src/runners/herdr-pane.ts` with `printf '\\033[2J\\033[3J\\033[H' && exec ...` as in v1 (`packages/software-factory/src/supervisor/launch.ts`).
