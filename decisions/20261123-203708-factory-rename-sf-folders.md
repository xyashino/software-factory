---
scope: factory/hq
summary: Rename apps/sf daemon and server folders to factory and hq
why: daemon and server named the Factory and HQ code, not their roles; each role now has its own folder.
date: 2026-11-23
tags: [factory, hq, rename, sf]
---

- `apps/sf/src/daemon/` -> `apps/sf/src/factory/`, beside `cell/`. Files keep their names.
- `procedures/server/` -> `procedures/hq/`. `startServer`, `stopServer`, `createServerToken` -> `startHq`, `stopHq`, `createHqToken`.
- `adapters/cli/server.command.ts` merged into `hq.command.ts`. The `sf server` alias still wires to the same commands in `legacy.command.ts`.
- `bootstrap/server-dispatch.ts` -> `entry-dispatch.ts`. `dispatchInternal` keeps its name.
- Port `server` -> `hq` (`HqPort`, `server-client.ts` -> `hq-client.ts`, `createHqClient`). The old `hq` port is the Factory-to-HQ link, so it is now `hqLink` (`HqLinkPort`, `hq-link-client.ts`, `createHqLinkClient`).
- Port `factoryDaemon` -> `factory` (`FactoryPort`, `factory.adapter.ts`). `daemon-health.ts` -> `health.ts`, `spawn-server.ts` -> `spawn.ts`.
- Tests follow the moves:
  - `test/unit/daemon/` -> `test/unit/factory/`, `server-*.test.ts` -> `hq-*.test.ts`, `server-dispatch` -> `entry-dispatch`
  - `factory-daemon.test.ts` -> `factory-lifecycle.test.ts`, `support/factory-daemon.ts` -> `support/factory-cli.ts`
- Unchanged: CLI names and aliases, env vars, HTTP routes and reply keys, `__server` and `__factory-daemon` markers, `sf-server.service` unit, `FACTORY_DAEMON_*` constants.
- Docs: `docs/cell.md` and `docs/hq-factory-cell-plan.md` point at the new paths.
