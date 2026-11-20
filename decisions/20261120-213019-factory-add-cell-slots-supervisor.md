---
scope: factory/cell-server
summary: Add cell slot API, supervisor adapter, and event stream
why: One PC runs several Cells; cell-server must enroll, start, stop and restart them and stream lifecycle events
date: 2026-11-20
tags: [cell-server, cells, supervisor, sse, db]
---

- `/api/v1/cells`: `GET` list; `POST` create; `POST /stop-all`; `POST /:id/start`; `POST /:id/stop` (`force`); `DELETE /:id` (409 unless stopped).
  - `:id` = slotId, cellId or name.
  - Create body: `repoRoot`, `factory`, `count` 1..`max_local_cells`, `name` only with count 1, `allowedLines`, `joinToken`.
- Create: repo needs `.factory/config.json` (`project`) and `.factory/lines/*.yml`. Names `<host>`, `<host>-2`, ... skipping names taken in repo.
  - Credential: explicit `joinToken` -> factory `join_token` -> mint `cell_join` via `supervisor_token`.
  - Enroll per slot before any row write; factory failure -> 502, no rows.
- Cell DTO omits `sessionToken`; list and create responses never carry it. Session token stored only in `cells.session_token`.
- Migration `0002_cell-slot-runtime`: adds `project_id`, `session_token`, `log_path`, `last_error`. Embedded in `migrations/index.ts`.
- Ports: `SupervisorPort.start(launch)` / `stop(slotId, {force})` / `status`; `FactoryClientPort.health` / `mintJoinToken` / `enroll`.
  - `RepoInspectorPort.inspect`. Transport context carries all three.
- Supervisor adapter: child process per slot.
  - Env: `FACTORY_URL`, `CELL_NAME`, `CELL_SESSION_TOKEN`, `CELL_LOG_PATH`, `HERDR_ENABLED`. Logs to `$XDG_DATA_HOME/sf/cells/<slotId>.log`.
  - Stop = SIGTERM, wait 10s, SIGKILL; `force` = SIGKILL. Crash restarts with `nextBackoffMs` while wanted.
- Boot: `reconcileRunningSlots` starts every `desired_state = running` slot. SIGTERM/SIGINT drains workers without changing desired state.
- `GET /api/v1/stream`: SSE `data:` JSON bus events (`cell.started|stopping|stopped|failed|removed`, `at`, `slotId`); unsubscribes on client abort.
- Open: worker `factory-cell` still reads `FACTORY_JOIN_TOKEN`, not the env above; live Herdr untested; enroll partial failure leaves factory-side cells enrolled without local rows.
