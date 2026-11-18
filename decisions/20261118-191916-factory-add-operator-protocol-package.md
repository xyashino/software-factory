---
scope: factory/operator-protocol
summary: Add operator-protocol package with verb and reply zod contracts
why: CLI and Cell must parse one wire format, and apps cannot import each other.
date: 2026-11-18
tags: [factory, operator, protocol, zod]
---

- New `packages/operator-protocol` (`@repo/operator-protocol`): constants, reply schemas, one contract per verb. Schemas and constants only.
- Verbs from PLAN §3: operator `done`, `verdict`, `block`, `context`; mechanic `read`, `incident`.
- Body schemas are `.strict()` and carry a `verb` literal and a `token` (16-256 chars).
- `verdict` takes `result` `pass` | `fail`: `fail` requires `feedback`, `pass` forbids it.
- `incident` takes `action` (five values), required `report`, optional `step`, `diagnosis`, `outcome`. `step` is required for `restart_from_step`.
- `diagnosis` and `outcome` stay optional until PLAN §3.2 confirms them (step-05).
- Reply shapes: 200 ok; 400 invalid; 401 unauthorized; 409 rejected, stale_epoch, not_live, precondition; 500 internal.
- ESLint forbids `process`, `node:fs`, `node:net`, `node:http` imports in `src/`.
- Wire differs from `factory-core` operator contract (`verb` field vs `op`). Both coexist until steps 02-07 migrate.
- Not changed: `factory-core`, `apps/cell`, `apps/operator*`.
