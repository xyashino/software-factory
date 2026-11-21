---
scope: factory
summary: Log runner, exit, duration, attempt and lifecycle steps in cell log
why: a run that failed before the agent started could not be diagnosed from the cell log alone
date: 2026-11-21
tags: [cell, logging]
---

- Operator `start` logs `runner model headless`; `complete`/`fail`/`block` log `exit duration` (`exit=pending` when a verb ends the run before the runner exits).
- Herdr `pane` line logs `ws tab pane`; `headless` line logs `fallback=<reason>` when a pane failed to open.
- Inspection logs own `start`/`complete` per command with `(epoch/maxAttempts)`, command text, exit, duration; transition lines skipped to avoid duplicates.
- New `claim` and `worktree` (create/reuse) lines; `worktree_missing` logs the missing file list.
- `RunHandle` gains optional `pane` ids, set by the herdr adapter, so the Cell can log them.
- `transition` takes optional log detail override (`null` skips the line); server payloads unchanged. 200-char cap kept; full output stays in `step.log`.
