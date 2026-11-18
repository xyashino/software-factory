---
scope: factory
summary: Rename todo specs to step-NN ids so intake accepts them
why: Ids like 01-cells-... read as host:port in order ids, and intake rejects them as machine-local.
date: 2026-11-18
tags: [factory, todos, intake]
---

- `todos/NN-*.md` renamed to `todos/step-NN-*.md`; `depends_on` links and titles updated to match.
- Intake validates each order id; `software-factory:01-...` matches the host:port rule, so every create failed.
- The 12 specs now form one plan, `factory-backend`, and migrate creates all 12 with no errors.
