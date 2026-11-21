---
scope: factory
summary: Unify root sf URL and token in global connection config
why: stale ~/.config token gave bare 401 with no target, source or fix
date: 2026-11-21
tags: [cli, auth, config]
---

- Global config `$XDG_CONFIG_HOME/sf/config.json` (fallback `~/.config/sf/config.json`), mode `0600`, atomic write; shape `{ current, targets: { name: { url, token } } }`.
- `sf connect <url> [--name] [--token | --token-stdin] [--default]` probes `GET /api/v1/projects`; a rejected token saves nothing; token never printed.
- `sf target ls|use|rm`; removing the active target clears `current`.
- URL precedence: `FACTORY_URL`, active target, default `http://127.0.0.1:7070`.
- Token precedence: `FACTORY_TOKEN`, `<cwd>/.factory-local/supervisor.token`, active target, `~/.config/factory/token` (legacy).
- Token source labels `env:FACTORY_TOKEN`, `repo:.factory-local/supervisor.token`, `config:<name>`, `legacy:~/.config/factory/token`; secret values never printed.
- `sf server start` saves a `local` target (`http://127.0.0.1:<port>`) when none exists; sets it active only when no target is active.
- `sf server token create --save` writes the `local` target to global config outside a factory repo or with `--global`; inside a repo it writes `.factory-local/supervisor.token`.
- 401 errors append target URL, token source label and recovery command; missing token names `sf connect <url>` or `sf server token create --save --global`.
