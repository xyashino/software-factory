---
scope: factory
summary: Add plan and six task specs for an Astro SSR web demo with localhost auto-registration, cells preview, and resume/delete-as-cancel
why: The web demo folder is empty; a small Astro app over factory-server gives a visible view and two write actions, and on the same machine it should register itself like a Cell instead of needing a hand-copied token.
date: 2026-11-18
tags: [factory, web-demo, astro, plan]
---

- New `apps/factory-web-demo/docs/PLAN.md` and tasks `todos/web-demo-01` to `web-demo-06` (skeleton, client, read pages, server web join, auto-register, write actions).
- Read pages: overview, cells preview (filter over `GET /api/v1/cells`), work orders, incidents.
- Write actions limited to `resume` and `cancel` via `POST /api/v1/work-orders/{id}/transitions`. Delete is cancel; hard delete is an open question.
- Localhost auto-registration: only on loopback, join secret file readable by the server's OS user, exchanged at `POST /api/v1/tokens/join` for a 24 h `web_session` with read and write scopes but no admin scope. Remote servers still require `FACTORY_TOKEN`.
- Server gains one route and one token kind (task 04). This is the only factory-server change in the plan.
- Writes need Origin checks because a local demo is reachable by cross-site forms.
- Astro and `@astrojs/node` versions from npm at planning time; to be pinned in `catalog:` at implementation.
- No code written.
