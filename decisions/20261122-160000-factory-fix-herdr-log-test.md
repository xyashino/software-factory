---
scope: factory
summary: Herdr log-tab test uses the injected log path
why: main test failed on a hardcoded /repo path and blocked pre-push
date: 2026-11-22
tags: [sf, herdr, tests]
---

- `herdr-runner.test.ts`: log-tab test expects `mkdir -p` and `touch` on `LOG_OPTIONS.logPath` instead of a hardcoded `/repo/.factory-local` path.
- Test now passes; `pnpm ci:verify` green, so pre-push hook passes.
