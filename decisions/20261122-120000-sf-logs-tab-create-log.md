---
scope: sf
summary: Logs tab creates the Cell log before tail
why: tail -F printed "cannot open" on every fresh Cell
date: 2026-11-22
tags: [sf, herdr, logs]
---

- `herdr.ts`: logs tab runs `mkdir -p` and `touch` on the log path before `tail -F`.
- Append-safe: `touch` keeps content. `-F` kept.
- Test: command string creates the log first.
