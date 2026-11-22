---
scope: factory
summary: Fix 401 hint per token source and name port owner
why: Global token command never replaces repo token, which wins token resolution, so the 401 fix must match the source
date: 2026-11-22
tags: [factory, cli, token, auth, errors]
---

- 401 message keeps reason, target and token source lines, adds `server at <url> rejected the token` and a port-owner hint.
- `tokenFixOf` picks the fix by token source: repo file gives `rm .factory-local/supervisor.token && sf server token create --save`.
- Env token gives `unset FACTORY_TOKEN, or set it to a token the server accepts`.
- Saved target and legacy home token keep `recoveryCommandOf` (`sf server token create --save --global` for loopback, `sf connect <url>` otherwise).
- Token precedence unchanged: env, then repo file, then saved target, then legacy home file.
- Blackbox tests assert the fix line for env, saved target, repo file and legacy home token sources.
