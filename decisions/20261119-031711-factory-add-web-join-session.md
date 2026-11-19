---
scope: factory
summary: Add web join secret and web session token kinds with loopback join route
why: Web demo needs a supervisor-scoped client that enrolls without a pasted admin token, like cells enroll with cell_join; session must read and write work orders but never mint tokens.
date: 2026-11-19
tags: [factory, server, tokens, web-demo, auth]
---

- New token kinds in `TOKEN_KINDS`: `web_join` (hashed secret, no scopes, single use) and `web_session` (scopes `supervisor:read`, `supervisor:write`; no `admin:tokens`; TTL 24 h).
- New `domain/tokens/web-session.ts` (pure): `WEB_SESSION_SCOPES`. `WEB_SESSION_TTL_MS` in `config.ts`.
- Startup writes `$FACTORY_DATA_DIR/web-demo.join` (`0600`, `FACTORY_DATA_DIR` defaults to the db directory). Each start revokes the previous `web_join` row and mints a new secret. Write failure aborts startup with a message naming the file.
- New `POST /api/v1/tokens/join` (public): non-loopback remote address gives `403`; wrong or already-used secret gives `401`; valid secret is consumed and a `web_session` returned as `201 { code, token, expiresAt }`. Consume and issue run in one `immediateTx`.
- Remote address now flows from Bun `server.requestIP` through Hono env into transport context (`remoteAddress`). Missing address counts as non-loopback.
- Tests: `test/blackbox/tokens-join.test.ts` (session reads cells, creates work order, gets `403` on `POST /api/v1/tokens`; reuse `401`; non-loopback `403`; wrong secret `401`; file mode `0600`).
