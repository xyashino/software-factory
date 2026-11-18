---
scope: factory
summary: Copy server wire contracts into the factory CLI
why: The CLI must send and parse the exact server shapes, but shared contracts only move to a package later.
date: 2026-11-18
tags: [factory, cli, contracts]
---

- New `apps/factory/src/contracts/`: Zod copies of every route the CLI calls, plus one schema per operator verb.
- Copied, not imported. Duplication is accepted until a shared package exists (factory PLAN 7).
- Request bodies are `.strict()`. Extra fields fail on both sides. Query and reply objects keep Zod default (strip).
- Field names match the server. Server-only fields (job `output`, `workspaceFailed`, work-order `workOrders`) are trimmed.
- Domain enum literals copied into `common.ts`, because the CLI must not import server domain.
- Reply errors in `common.ts`: `400 invalid`, `401 unauthorized`, `409 conflict`, `500 internal`.
- 409 uses `code: 409` and `type` from `rejected | stale_epoch | not_live | precondition | already_applied`. Matches server `errorResponse` shape.
- Dropped: order-plan create/get/transition, projects, tokens. No CLI command uses them.
- Operator: `verdict` (fail needs feedback) and `incident` (`restart_from_step` needs step) use `superRefine`. Union uses `z.union`, since `discriminatedUnion` rejects refined members.
- Operator bodies carry `token` (operator PLAN 6). File content goes in `feedback`, `handover`, `report`.
- No schema for `answer`, `tell`, `ask` or cell drain (open in factory PLAN 8).
- Drift test: every field name in a CLI contract file must appear in its server file. Operator file is checked against operator PLAN.
- Drift check is a word match. A server rename or removal fails. Enum values and types are not compared.
- 54 unit tests in 11 files pass: one valid body parses and one unknown key is rejected per contract.
