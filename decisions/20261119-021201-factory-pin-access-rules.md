---
scope: factory
summary: Pin procedure access rules with black-box HTTP tests
why: Refactor changed access checks; no HTTP test pinned all-of and any-of Forbidden messages
date: 2026-11-19
tags: [factory, procedure, access, testing]
---

- New `test/blackbox/procedure-access-rules.test.ts`, 6 story-named tests through `app.request()`.
- Real routes: `GET /api/v1/projects` (`scopedProcedure`, `supervisor:read`), `POST /api/v1/incidents/:id/resolve` (`anyScopedProcedure`).
- Test-local probe: `scopedProcedure(['supervisor:read', 'supervisor:write'])` for the missing-scope refusal. No real multi-scope route exists.
- Test-local probe: `publicProcedure` for the no-bearer success case. No production public route exists.
- Asserts exact `Token lacks scope: supervisor:write` and `Token needs one of: supervisor:write, cell:worker` messages.
- Confirms no bearer on a scoped route returns 401 `Missing or invalid bearer token`.
- No `src/` edits: `git diff -- apps/factory-server/src` is empty; 26 files still use the procedure helpers.
- Test-only change; no production behaviour changed.
