---
scope: factory
summary: Adapter reads only declared request sections
why: Undeclared params, query and body were always parsed, and non-JSON bodies failed with a generic error
date: 2026-11-18
tags: [factory, adapter, http, validation]
---

- `adapters/hono/adapter.ts`: reads `procedure.contract.in` once when the adapter is built.
- `params` and `query` come from `c.req` only when declared; otherwise `{}`. Zod ignores undeclared sections either way.
- `body` is read only when declared. Undeclared body stays `undefined`.
- Private `readJson` replaces `readBody`. Empty body returns `undefined`, so Zod decides when a body is required.
- Non-empty body without `Content-Type` starting `application/json` returns `400` with `Unsupported Content-Type, expected application/json`.
- Check is case-sensitive, as the spec states. `parseJson` and its `Malformed JSON body` message are unchanged.
- No procedure, contract, route or existing test edited. No factory-server contract declares a non-JSON body.
- New `test/blackbox/adapter-declared-sections.test.ts`: 5 cases through `app.request()`.
- GET-with-body case cannot be sent: Node `Request` rejects a body on GET/HEAD. Substituted a POST with undeclared body and `text/plain`.
