---
scope: factory
summary: Open operator and mechanic panes in one tab of the task workspace
why: After a Cell restart a pane made a second workspace with the task label, and tabs piled up per task.
date: 2026-11-17
tags: [factory, cell, herdr, pane, workspace]
---

- Before creating a task workspace, the Herdr driver lists workspaces and reuses the one labelled with the task. It creates one only when none exists, so a restart adds no duplicate.
- `closeTask` looks the workspace up the same way, so a delivered task closes its workspace after a restart too.
- Each pane still opens one new tab with its own `--cwd`. The workspace's cwd is never relied on.
- Before a new tab opens, the earlier tab of the same task and lane closes. Lanes: the Operator's tabs, and the Mechanic's `mechanic_*` tabs. At most one of each per task.
- Tabs adopted after a restart carry no task, so they are not closed by this rule. Known limit.
