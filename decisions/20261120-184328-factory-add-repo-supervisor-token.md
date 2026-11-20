---
scope: factory
summary: Read supervisor token from repo .factory-local
why: CLI needs no FACTORY_TOKEN or home token file inside this repo, and the stale home token returns 401
date: 2026-11-20
tags: [factory, cli, token, auth]
---

- Token read order: `FACTORY_TOKEN`, then `./.factory-local/supervisor.token`, then `~/.config/factory/token`. First non-empty wins.
- Write and clear target is the repo file (first path in the list), so one file serves both reads and a stale repo file cannot shadow a new home token.
- Side effect: running `server token create --save` outside the repo writes `./.factory-local/supervisor.token` in the cwd, same rule as `cell.json`.
- `createTokenFile` takes an ordered path tuple; `buildContext` passes the cwd-resolved repo path and the home path.
- Unit tests cover env, repo, home and empty-file fallback, and write mode 0600.
- Blackbox `server token create --save` test runs with cwd in its sandbox home, so it never touches the real repo token.
