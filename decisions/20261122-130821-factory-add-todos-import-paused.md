---
scope: factory/todos
summary: Add --paused to todos import
why: first import can start many jobs at once; pause on import instead of editing files
date: 2026-11-22
tags: [todos, import, sf]
---

- `sf todos import --paused`: sends every todo with `status: paused`, except `cancelled` which stays cancelled.
- Pause applies to the markdown payload only; `todos/*.md` on disk are never written.
- Output: `paused N` in apply and dry-run summary; `--dry-run --paused` previews the count.
- `ImportResult.paused` added; `paused` input defaults to false, so existing calls are unchanged.
- Tests: unit (paused payload, cancelled kept, dry-run count) and blackbox (dry-run count, file unchanged).
