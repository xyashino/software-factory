---
scope: factory
summary: Add sf web start, stop and status for the factory web UI
why: Web UI needed a running server and manual FACTORY_DATA_DIR; sf web manages its lifecycle with XDG defaults
date: 2026-11-20
tags: [web, cli, pid-file, xdg, lifecycle]
---

- `sf web start|stop|status` in `apps/factory/src/adapters/cli/web.command.ts`, procedures in `application/procedures/web/`, wired in `cli.ts`.
- `start`: flags `--host` (127.0.0.1), `--port` (4321), `--json`. Refuses while `web.pid` names a live process.
  - Probes factory server first; down -> exit 3, message names `sf server start`.
  - Project id read from repo `.factory/config.json` (`readProjectId`), not from env.
  - Spawns detached `process.execPath <webEntry>` with `FACTORY_URL`, `FACTORY_DATA_DIR`, `FACTORY_PROJECT_ID`, `HOST`, `PORT`; log `web.log` in data dir.
  - Polls the URL for 10 s; no answer -> terminate, remove pid, exit 3.
- Runtime is `process.execPath`, not `node` on PATH: Volta's `node` shim forks the real node, so SIGTERM to the shim left the web UI serving.
- Web entry resolution (`webEntryPath` in `config.ts`): `SF_WEB_DIR/server/entry.mjs`, `/usr/local/share/sf/web/...`, `/usr/share/sf/web/...`, then `apps/factory-web-demo/dist/server/entry.mjs`. Missing -> exit 1, names the path.
- `stop`: SIGTERM, wait up to 10 s, remove `web.pid`. Reports `stopped` or `not-running`.
- `status`: read-only, no probe; stale `web.pid` is reported stopped and kept.
- PID file name parameterized: `createPidFile(fileName = 'server.pid')`; `webPidFile` = `web.pid` in `Ports` and `buildContext`.
- `ProcessPort.probeUrl(url)` added; `spawn-server.ts` adapter uses `fetch` with 1 s timeout.
- `apps/factory-web-demo/src/lib/config.ts`: loopback without `FACTORY_DATA_DIR` defaults to `$XDG_DATA_HOME/sf`, fallback `~/.local/share/sf`. Old loopback error removed; remote token rule kept.
- `turbo.json` globalEnv: `SF_WEB_DIR` added (lint `turbo/no-undeclared-env-vars`).
- Tests:
  - `apps/factory/test/unit/application/web-procedures.test.ts`: start refusal, unreachable without spawn, spawn env, terminate on timeout; stop and status outcomes.
  - `apps/factory/test/blackbox/web-commands.test.ts`: live data via fake entry at `SF_WEB_DIR`, status JSON, duplicate start, stop, server-down exit 3.
  - `apps/factory-web-demo/test/unit/config.test.ts`: XDG default and `~/.local/share` fallback replace the old error case.
- Not changed: `session.ts` guard stays, since `FACTORY_DATA_DIR` is still optional for remote+token.
- Checks: `pnpm ci:verify` green (51 tasks), format, nitpick (see evidence dir).
