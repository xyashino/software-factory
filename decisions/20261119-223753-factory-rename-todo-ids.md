---
scope: factory/todos
summary: Rename two todos whose ids tripped the pane id guard
why: Todo ids with pane- were rejected by the machine-local id check, so todos migrate could not import them
date: 2026-11-19
tags: [v2, todos, migration]
---

- Rename `todos/factory-herdr-pane-runtime.md` to `todos/factory-herdr-runtime.md`.
- Rename `todos/factory-mechanic-pane-and-logs.md` to `todos/factory-mechanic-tab.md`.
- Update `depends_on` and the body references to the new ids in both files.
- Cause: `isMachineIndependentId` in `packages/factory-core/src/machine-local.ts` rejects `pane[-_:]\w+`, which matches `-pane-runtime` and `-pane-and`.
- Add `factory: v2` to both frontmatters so `todos migrate` imports them without `--all`.
