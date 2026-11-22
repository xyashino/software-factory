---
scope: docs
summary: Add VPS and headless setup section with troubleshooting
why: first VPS run hit install path, leaked port 7070 server and misleading 401 hint
date: 2026-11-22
tags: [docs, vps, onboarding, troubleshooting]
---

- README gets "Set up a VPS (headless)": prerequisites, install from checkout, `sf doctor`, `sf setup`, runner login, web UI via `ssh -L 4321:127.0.0.1:4321`, Cell under tmux.
- Placed in README, not `docs/`: `docs-restructure-root` has not landed. Move with that todo.
- Troubleshooting table covers four failures: install path, port 7070 owner, 401 by token source, missing runner. Each row has check and fix.
- Install fix documented as workaround `--source apps/sf/dist`. Code fix stays in `install-fix-source-path`.
- 401 fix documented per token source. Printed `--global` hint is wrong for repo token; code fix stays in `error-hint-token-rejected`.
- `FACTORY_HOST` documented as network exposure: only behind Tailscale or TLS.
- `sf service install` not documented: not in `sf --help`. tmux used instead.
- Verified in isolated scratch repo with `FACTORY_PORT=7171`: `sf setup` twice (second run all skipped), `sf doctor` ok, web start/status/stop, queue, token save, cell start and list.
- Verified 401 with repo token file: fix `sf server token create --save` restored access.
- Verified foreign listener on port: `sf server start` printed started, server died, `sf server stop` left the listener alone.
- No code changed. README is the only doc changed.
