---
scope: factory
summary: Mechanic keeps its herdr tab open after a normal exit
why: mechanic tab closed on exit and fallback reason was not logged when herdr was down
date: 2026-11-22
tags: [sf, herdr, mechanic, cell]
---

- `RunnerPort.abort` takes `{ keepPane }`: stops the agent process tree, skips the tab close.
- herdr adapter: a kept run is no longer the previous run, so the next `start` does not close its tab.
- Mechanic runs keep their pane when the incident is resolved (`operator` outcome); abort and timeout still close it.
- Station runs are unchanged: their pane closes on operator verb, abort and timeout.
- Plan carries `reason`: herdr server down logs `headless fallback=herdr server unavailable`.
- Runner without an interactive command logs `fallback=no interactive command for runner <name>`.
- Abort log line gains `pane=kept` when the pane stays open.
- Tests: herdr adapter keeps tab on `keepPane`, next start does not close it; mechanic logs pane ids, keeps pane on resolve, closes on timeout, logs herdr-down fallback.
