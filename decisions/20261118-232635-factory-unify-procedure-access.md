---
scope: factory
summary: One define factory owns procedure access checks
why: Three duplicated procedure helpers; adapter could not see the access rule or contract
date: 2026-11-18
tags: [factory, procedure, access, refactor]
---

- `procedure.ts`: `publicProcedure`, `scopedProcedure`, `anyScopedProcedure`, `authenticatedProcedure` built by one private `define(access)`.
- `Procedure` is now `{ access, contract, execute }` instead of a bare function.
- Private `checkAccess` owns authentication plus all-of and any-of checks; casts only there.
- `ContextFor<A>`: public gets `TransportContext`, every other rule gets `AuthenticatedContext`.
- Forbidden messages byte-identical to before.
- `authorize` stays exported and delegates to `checkAccess` with the all-of rule (used by stream route).
- `adapters/hono/adapter.ts`: calls `procedure.execute`; outside the todo boundary, required for check-types.
- Handlers, routes, contracts unchanged. No new tests.
- Renamed ADRs `20261118-240000`, `250000`, `260000` (invalid hour) to `20261119-000000`, `010000`, `020000` so decision-log check passes.
