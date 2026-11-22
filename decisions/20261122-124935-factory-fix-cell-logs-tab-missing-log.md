---
scope: factory/cell
summary: Cell logs tab creates its log before tail follows it
why: Fresh Cells printed tail "cannot open" warnings until the worker created its lazy log file
date: 2026-11-22
tags: [cell, herdr, logs, tail]
---

- The Cell workspace's logs tab creates the Cell log file and its parent dir before `tail -F` runs.
  - Append mode (`appendFileSync` with empty data), so existing log content is kept.
  - Creation sits after the pane lookup and before the tab rename, so a missing pane skips it.
- `-F` stays, so the tab still follows the file after rotation or re-creation.
- Tests: the logs tab creates a missing log, and keeps existing content.
