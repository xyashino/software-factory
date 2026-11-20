---
scope: factory
summary: Build sf as one standalone binary with a root install script
why: sf and factory-server ran from monorepo TypeScript paths, so a global sf could not start the server or web UI outside the checkout
date: 2026-11-20
tags: [cli, build, install, server, web]
---

- `bootstrap/server-dispatch.ts`: `sf __server` runs factory-server, `sf __web <entry>` runs the Astro node entry; checked before citty so normal commands never start a server.
- `__server` strips its marker from `process.argv`, so `admin token create` still matches factory-server's argv check.
- `serverArgsOf` / `webArgsOf` in `config.ts`: compiled binary (`/$bunfs/`) spawns `__server` / `__web <entry>`; dev keeps the source entry path, unchanged.
- Server and web procedures take `serverArgs` / `webArgs` instead of a raw entry path; web keeps `webEntry` to check the file exists before spawn.
- `pnpm build:sf` (root): `bun build --compile` to `apps/factory/dist/sf`, Astro build, then `pnpm deploy --prod` of web deps into `apps/factory-web-demo/dist/sf-deps`.
- `scripts/install.sh`: `PREFIX` (default `/usr/local`), `DESTDIR`, `SF_WEB_DIR`; installs `bin/sf` (0755) and `share/sf/web` with `server/`, `client/`, `node_modules/`. Fails fast when a build output is missing.
- `apps/factory/tsconfig.json`: `rootDir` widened to `apps/` and `factory-server/src/sql.d.ts` included, so the dispatch import type-checks.
- Init templates and SQL migrations are embedded in the binary; no template or `.sql` read from disk.
- Tests: unit dispatch routing and spawn-arg helpers; blackbox `__server admin token create` prints a token.
- Proof: compiled `sf` from an empty git repo outside the monorepo: init, server start, token, project add/ls, web start (HTTP 200), web status, web stop, server stop.
- Limit: `sf cell` not run end to end from the compiled binary.
- Limit: web needs `SF_WEB_DIR` when installed under a non-default prefix; default runtime lookup stays `/usr/local/share/sf/web`.
