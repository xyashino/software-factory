---
scope: docs
summary: Replace stale server, cell start and operator names in docs
why: Skills and README still used server, sf cell start, done state and old operator names after HQ renames
date: 2026-11-23
tags: [docs, skills, hq, factory]
---

- `boss-factory` skill: `server` -> `HQ`, start commands `sf hq start`, `sf web start`, `sf factory start`, `sf cell scale <N> --repo <path>`.
- `boss-factory` skill: final order states `delivered`, `completed`, `blocked`, `cancelled` (no `done`). `--step <index>` kept.
- `factory-install` skill: description and activation text say HQ instead of server.
- `README.md`, `docs/hq.md`: operator names match `.factory/operators/` (`planner`, `plan-reviewer`, `builder`, `doctor`, `mechanic`).
- `.agents/`, `AGENTS.md`, `CLAUDE.md` regenerated via `bun run nitpick:sync`.
