---
scope: factory/trial
summary: Add Cell tail fix and Mechanic todos to the feature trial branch
why: Let the local v2 factory run both the inspection tail fix and M10 Mechanic on the feature Line
date: 2026-11-15
tags: [v2, trial, feature, cell, mechanic]
---

- Add `todos/v2-fix-inspection-tail-sanitization.md` with `factory: v2`, `workflow: feature`, and `priority: high` so `apps/cell` sanitizes machine-local paths and host:port strings in inspection/failure tails.
- Add `todos/v2-24-mechanic.md` with `factory: v2`, `workflow: feature`, and `depends_on: [v2-fix-inspection-tail-sanitization]` to run M10 Mechanic triage after the Cell tail fix delivers.
