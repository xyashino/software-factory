---
scope: factory
summary: Fix adopted operator and mechanic tabs closing by task after restart
why: A tab adopted after a Cell restart carried no task, so the one-tab-per-lane rule left it open beside the new tab.
date: 2026-11-17
tags: [factory, cell, herdr, pane, adopt]
---

- `PaneDriver.adopt` takes the task of the pane: `adopt(name, location, task)`.
- The reconcile discard path passes the session's `taskName`. The operator station's adopted branch passes its todo.
- An adopted tab of a task closes when the next Operator or Mechanic of that task opens, the same as a tab this Cell opened.
- A tab adopted for another task stays open.
- Replaces the known limit of `20261117-115011-factory-fix-tabs-per-task`: adopted tabs no longer skip the lane rule.
