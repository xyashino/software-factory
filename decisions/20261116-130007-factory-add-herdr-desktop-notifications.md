---
scope: factory
summary: Herdr toasts for questions, blocks and deliveries
why: Operators missed questions, Andons and deliveries; v1 toasted them, v2 never called HerdrPort.notify
date: 2026-11-16
tags: [cell, herdr, notifications, config]
---

- `notify` is a plain function on the Cell, not a `PaneDriver` method: `cell.ts` options, `JobContext`, `StationDeps`.
  - Built in `main.ts` from `createHerdrAdapter().notify`, only when `notificationsEnabled` holds.
- `notificationsEnabled` is on when config `notifications` (default `true`) is set, the Cell is not `headless_operators`, and `FACTORY_NOTIFY` is not `0`.
- `notifyQuietly` (`jobs/notify.ts`) never throws: no `notify` is a no-op; a refusal or a 5 s timeout is appended to `notify.log` in the Cell data dir.
  - Every toast is fired without awaiting, so no Cycle, Andon or Delivery waits on Herdr.
- Toasts (`sound: 'request'` or `'done'`):
  - `Question: <todo>` with the question text, cut to 200 characters, when an Operator asks.
  - `Blocked: <todo>` with the block reason, plus the PR URL when published, after every `ReportBlockedPr`.
  - `Delivered: <todo>` with the PR URL, after `ReportDelivery{finished}`. A failed delivery is silent.
- An operator `block` does not toast on its own: the Andon's `publish_blocked` job toasts once.
