---
scope: factory
summary: sf cell scale N replaces cell create, stop and rm
why: Desired Cell count per project is the only state. Count lives in memory and the daemon converges it, so named slots go
date: 2026-11-22
tags: [factory, cell, scale, daemon, cli]
---

- `sf cell scale N` inside a repo with `.factory/config.json`: `PUT /scale` on the Factory daemon. No `--project`, no `--name`.
- Project from the repo config. Not on HQ: refused with `sf project add <id> --repo <url>`. Outside a repo: refused.
- Daemon state in memory: `{ repoRoot, desired, lines }` per project. Restart or HQ loss resets to 0.
- Scale up refused while HQ is not connected. One repo path per project per Factory, else refused naming the first.
- Scale down order: idle, then read-only stations (`permission: read`), then newest writing station.
- Kill first (confirmed exit), then HQ gone. HQ gone failure ignored.
- Exit not requested: respawn after 1, 2, 4 ... 30 s. 5 exits in 60 s: `crash loop`, no respawn until next `scale`.
- Cell posts `idle` at claim wait and `running` at station start to `POST /cells/:id/activity`. Best-effort, unknown Cell 404.
- Cell id reaches the worker as `SF_FACTORY_CELL_ID`.
- `sf cell list`: per project repo, desired, running, Cell id and state, `crash loop` flag. Daemon view, not HQ rows.
- `cell create|stop|rm` removed: exit 2 with `use "sf cell scale N"`. `cell stop` procedure removed; HQ drain endpoint kept.
- Outside-repo clone (`ensureWorkspace`, `WORKSPACES_DIR`) removed. `cell start` outside a repo refused.
- `setup --cell` is a flag: scales the repo to one Cell when none runs.
- Daemon routes: `POST /cells`, `GET /cells`, `DELETE /cells/:id` removed. `GET /scale`, `PUT /scale`, `POST /cells/:id/activity` added.
