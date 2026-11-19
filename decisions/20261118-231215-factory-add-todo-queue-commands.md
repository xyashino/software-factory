---
scope: factory
summary: Add factory todos import/export and factory queue list and actions
why: Todo files are the human source and the server holds live state; the CLI must move work orders between them and run bulk queue actions without writing files.
date: 2026-11-18
tags: [factory, cli, todos, queue]
---

- `factory todos import [--dir todos] [--dry-run]`: reads `.factory/config.json` `project`, skips files without `line`, one `POST /api/v1/queue/import` with a `commandId`. `--dry-run` sends nothing.
- `factory todos export [--dir todos] [--force]`: one `GET /api/v1/queue/export`, writes server markdown verbatim. Existing files are refused unless `--force`; refused files are listed and exit 1.
- `factory queue [--state] [--line] [--plan] [--json]` and `queue list`: `GET work-orders` plus `GET order-plans` for plan slugs. Never writes files.
- `factory queue pause|unpause|reprioritise|reset|cancel <orderIds...>`: one `POST /api/v1/queue/actions`. `reset` sends `reset_to_scratch`. `reprioritise` needs `--priority`. `cancel` needs `--yes`, otherwise exit 2 and lists the ids.
- `parseTodo` and `renderTodo` in `domain/todo`: round trip keeps every field and the body. Status and priority are not enforced client-side; the server validates on import.
- Server 422 on import keeps its per-file `errors`; `Refused` now carries the reply body as `details`.
- Ports: `ServerPort.get`, `TokenStorePort.secret`, new `TodoFilesPort`; fs port now wires `readText` and `exists`.
- `.factory/config.json` `project` is the only project source; no project flag.
