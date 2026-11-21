---
scope: factory
summary: Plan onboarding and cell runner fixes, add todos
why: first VPS setup failed on install path, port clash and a misleading 401
date: 2026-11-21
tags: [todos, onboarding, cell]
---

- `docs/onboarding-plan.md`: verified facts, order, open decisions, risks.
- Fixes: `install-fix-source-path`, `server-start-verify-own-process`, `error-hint-token-rejected`.
- Tests: `onboarding-smoke-test` runs install and quickstart in CI.
- Features: `sf-doctor`, `sf-setup`, `sf-project-add-defaults`, `server-service-units`, `release-binary`, `todos-import-paused`.
- Docs: `docs-vps-quickstart`.
- `docs/cell-runner-plan.md`: VPS duplicate-agent incident, verified code paths, unverified items.
- Cell runner: `cell-runner-confirm-exit`, `cell-single-runner-lock`, `cell-sigterm-during-job`, `cell-run-outcome-logging`, `drain-force-and-offline-stop`.
- No product code changed.
