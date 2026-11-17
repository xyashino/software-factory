---
scope: factory/server
summary: Layer factory-server into application, adapters and bootstrap
why: One procedure per route and one error mapping replace the serveRoute switch; wire protocol and http/ import paths stay unchanged
date: 2026-11-17
---

- procedures: `application/procedures/<domain>.procedures.ts` hold one procedure per `HTTP_ROUTES` route, transport-neutral
- access tiers (`supervisorProcedure`, `cellProcedure`, ...) take their credential from `HTTP_ROUTES`, so each route's auth is written once
- adapter: `adapters/hono/adapter.ts` checks the credential, reads the body in the procedure's form, maps output to 204, octet-stream or JSON
- errors: one `.onError` maps every failure through `toWireError`; no per-route try/catch; unknown path answers `not_found`
- auth: `adapters/auth/auth.adapter.ts` holds the former `callerOf` / `lookupCaller` / `admits` unchanged; cache moved to `adapters/auth/auth-cache.ts`
- routes: `adapters/hono/routes/<domain>.route.ts` mount each domain's procedures; `stream.route.ts` serves SSE `/v1/stream`
- bootstrap: `bootstrap/transport.ts` wires runtime facade, auth and revoke-driven cache eviction once per app
- `once.ts` parses requests with `withRouteSchema` and maps refusals with `toWireError`; exit codes unchanged
- `http/app`, `http/auth-cache`, `http/github-webhook`, `http/stream` keep their paths as re-exports; `apps/cell` needs no edit
- `wire.ts` moved to `adapters/hono/wire.ts`; `failureResponse` removed (its job is the error handler)
- unchanged on the wire: `HTTP_ROUTES` paths and methods, `WireError` bodies, `WIRE_STATUS`, 204 claim, octet-stream blobs, SSE, raw-body HMAC webhook
- not added: request-id, no-cache and body-limit middlewares; no current behaviour to keep, and a limit would add an unspecified 413
- new tests: route registry lists each HTTP route once across domain procedures and answers every route; error mapping; adapter edge cases
