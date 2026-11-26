---
scope: repo/todos
summary: Unblock todo lint that failed the pre-push ci:verify
why: Todo status delivered is not allowed, and cda62160 removed a todo that sf-local-mode-cli depends on
date: 2026-11-26
tags: [todos, lint, pre-push, ci]
---

- Deleted three todos marked delivered: `hq-rate-limit-and-auth-brake`, `sf-plan-reset-from-scratch`, `sf-untrusted-input-sanitization`.
- Restored `factory-queue-import-endpoint`, `factory-local-engine`, `factory-app-extract`, `factory-contracts-package` from `cda62160^` as queued.
  - `sf-local-mode-cli` depends on this chain and their branches are not in `main`.
- `bun run todo:lint` prints `todo:lint ok`.
