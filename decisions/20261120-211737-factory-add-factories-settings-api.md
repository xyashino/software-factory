---
scope: factory/cell-server
summary: Add factory targets and machine preferences APIs with token redaction
why: Workers need saved Factory Server targets and persisted preferences instead of per-invocation FACTORY_URL and FACTORY_JOIN_TOKEN
date: 2026-11-20
tags: [cell-server, factories, settings, http, db]
---

- `GET/POST /api/v1/factories`: list ordered by `isDefault` desc, `name` asc. Upsert by `name`: insert or update `url` and tokens; omitted token keeps, `null` clears, string replaces.
- `POST /api/v1/factories/:id/default`: clears all defaults and sets target in one `immediateTx`; 404 when unknown.
- `DELETE /api/v1/factories/:id`: 404 when unknown; 409 when `cells` still reference it (guard runs before delete); deleting the default leaves zero defaults.
- Factory DTO: `factoryId`, `name`, `url`, `isDefault`, `hasJoinToken`, `hasSupervisorToken`, timestamps. Tokens stored in `join_token` / `supervisor_token`, never serialized (explicit mapper, not Zod stripping).
- Migration `0001_hot_lucky_pierre`: adds `name` (unique index `idx_factories_name`), `join_token`, `supervisor_token`. Hand-edited `ADD name ... DEFAULT ''` + `UPDATE ... name = factory_id` backfill so populated DBs migrate; generated form fails on NOT NULL without default.
- `GET/PATCH /api/v1/settings`: keys `herdr_enabled` (false), `default_runner` (claude; claude|codex|cursor|antigravity|opencode), `restart_backoff_ms` (1000; 0..600000), `max_local_cells` (4; 0..64), `git_fetch_on_worktree` (true). Unknown key or invalid value rejects whole patch with 400, no partial write. GET merges stored rows over defaults.
- Domain (pure): `validateFactoryUrl` accepts http/https only and strips trailing slash; `validateFactoryName` trims, rejects blank; `preferences.ts` owns setting keys, defaults, value validation. `machine-settings.ts` (host/port bind config) untouched.
- Application: domain `RangeError` mapped to 400 via `asBadRequest`; `HttpStatus` gains 409 with `Conflict` class.
- Runner list copied into cell-server domain: cross-app import from `apps/factory` forbidden.
- Open choices: create/upsert returns 200 (not 201) to match health route style; patch body is `z.record(z.string(), z.unknown())` with validation in domain, so one validator owns type and range rules.
