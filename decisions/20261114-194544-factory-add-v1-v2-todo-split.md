---
scope: factory
summary: v1 skips factory v2 todos so both can run side by side
why: The M9 trial needs v1 and v2 on one repo without ever taking the same todo
date: 2026-11-14
tags: [v2, cut-over, v1, intake, docs]
---

- The one allowed v1 edit (docs/README.md, ROADMAP M9): `packages/software-factory/src/supervisor/pick-todo.ts` skips a todo whose frontmatter has `factory: v2`.
  - The skip is silent, like v2's own filter. A test proves such a todo is never picked.
- v2 side: `RuntimeConfig.v2Only` already exists (default on). It is now settable with `FACTORY_V2_ONLY` (`1` or `0`, anything else refused at start), in `apps/server/src/runtime-config.ts`.
  - Documented in PROTOCOL §5.1.
- New `docs/TRIAL.md`: how to mark trial todos, what to watch, the exit criteria.
- Out of scope: running the trial, switching `sf` scripts to `factory`.
