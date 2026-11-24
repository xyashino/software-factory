---
scope: factory
summary: Add POST /queue/import to Factory server
why: Factory reads todos on the local machine; import must run there, into local engine when standalone or forwarded to HQ when connected
date: 2026-11-24
tags: [factory, queue-import, standalone, hq]
---

- `POST /queue/import` on `apps/factory` (outside `/api/v1/`, so the connected 409 guard does not block it).
- Body `FactoryImportRequestSchema` in `@repo/factory-contracts/queue.contract`: `repoRoot`, `dir?`, `dryRun`, `paused`, `local`; strict.
- Gate: `local` + connected -> 409; standalone + `local: false` -> 409; HQ `unreachable` -> 503; HQ `rejected` -> 409; connected + `local: false` without bearer -> 401.
- Reads `<repoRoot>/.factory/config.json` (project id, 400 if missing) and `<repoRoot>/todos/*.md` (or `dir`, resolved against `repoRoot`).
- Skips files without `line` (`no line`) and frontmatter parse errors; `paused` sets `status: paused` in sent markdown only, disk untouched.
- `dryRun`: preview counts, no writes, no HQ call.
- `local: true`: upsert project in local engine (base `main`), then local `POST /api/v1/queue/import`.
- `local: false`: forward to HQ `POST /api/v1/queue/import` with caller's bearer; HQ 422 -> `errors`.
- Todo parse/render copied into `apps/factory/src/todo/todo-markdown.ts` (adds `yaml` dep); duplicates `apps/sf` logic, follow-up: shared package.
- Out of scope: `apps/sf` CLI `--local` flag, `sf-local-mode-cli`.
