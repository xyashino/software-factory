---
scope: factory
summary: Run Herdr steps in one Cell workspace, one tab per step
why: Herdr runs opened a tab per run in a workspace found by env var; the Cell now owns one workspace and routes runs through it
date: 2026-11-19
tags: [v2, herdr, cell, runner]
---

- `apps/factory/src/adapters/runners/herdr.ts`: `createHerdrRunner(processPort, cellName)`.
  - Finds or creates the workspace labelled `factory:<cellId>`, once per runner.
  - A failed lookup is retried on the next start.
  - Every step tab opens in that workspace.
- The previous step tab is still closed before the next one opens. `FACTORY_HERDR_WORKSPACE` is gone.
- `apps/factory/src/bootstrap/context.ts`: runner is `createRoutingRunner(headless, herdr)`. Only runs with `spec.interactive` go to Herdr; nothing sets that flag yet, so behavior is unchanged.
- `.factory/config.json`: `herdr.tabPerRun` and `herdr.closePreviousOperatorTabs` removed.
- Not in this change: pane metadata, `agent start|prompt` TUI driving, Cell stop/revoke closing the workspace, and the line `headless` flag.
