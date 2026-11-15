---
scope: factory/cell
summary: logs tab clears the echoed command, then execs the log follower
why: v1 parity; the echoed log command and shell prompt sat above the log output in the logs tab
date: 2026-11-15
tags: [v2, herdr, logs, cell]
---

- The task workspace's `logs` tab runs `printf '\033[2J\033[3J\033[H' && exec <logCommand>` through `herdr pane run`, as v1's supervisor launch does.
- The escape clears the visible screen and scrollback, so the echoed `factory log <orderId> -f` line and the initial prompt are gone before the follower renders.
- `exec` replaces the shell with the log follower, so the pane stays on the follower.
- `logCommandOf` is unchanged: the raw command is still what callers pass to `pane.open`.
