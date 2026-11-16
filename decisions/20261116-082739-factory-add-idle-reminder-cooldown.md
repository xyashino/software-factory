---
scope: factory/cell
summary: Add cooldown between idle reminders before a Cycle stalls
why: A briefly idle Operator was stalled within a few 1 s watch ticks
date: 2026-11-16
tags: [cell, operator, watch, idle, cooldown]
---

- `idleCooldownMs` defaults to `45_000` in `DEFAULT_WATCH_TIMING` and is required on `WatchPolicy`.
- `RuntimeCycle.lastIdleReminderAt` records when the last idle reminder was sent; `watch()` stays pure and only reads it.
- While an idle Operator is inside the cooldown, `watch()` returns `none`: no reminder count increment and no stall.
- Default timing: reminder at 0 s, second reminder at 45 s, `stalled` at 90 s if still idle.
- The station records `lastIdleReminderAt` only for idle reminders; silent reminders are unchanged.
- Resuming work does not reset `lastIdleReminderAt`, so a resumed Operator that goes idle again still waits out the cooldown.
