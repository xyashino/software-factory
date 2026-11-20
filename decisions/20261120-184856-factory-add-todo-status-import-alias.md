---
scope: factory
summary: Add todo status as queued alias on queue import
why: v1 todo files and the create-todo skill emit status todo, so v2 import rejected them with 422
date: 2026-11-20
tags: [v2, queue, import, todo, create-todo]
---

- `parseTodo` maps `status: todo` to `queued` before the status check; `TODO_STATUSES` and export still emit `queued`.
- Other statuses still fail with `status must be one of queued, paused, cancelled`.
- `create-todo` skill emits `status: queued`, a `line:` field and the `# <slug>: <title>` heading the importer reads.
- Checks: factory-server tests, lint, check-types and prettier pass; root `pnpm ci:verify` green.
