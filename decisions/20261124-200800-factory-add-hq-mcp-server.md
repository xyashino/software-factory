---
scope: factory/hq
summary: Add Streamable HTTP MCP endpoint to HQ
why: AI clients need supervisor queue ops without the sf CLI or raw HTTP
date: 2026-11-24
tags: [hq, mcp, api]
---

- `POST /api/v1/mcp`: stateless Streamable HTTP JSON-RPC 2.0, protocol `2025-06-18`, no `Mcp-Session-Id`.
- Methods: `initialize`, `notifications/initialized` (202 empty), `tools/list`, `tools/call`. Batch arrays rejected (-32600).
- 11 tools wrap existing procedures, no new domain logic.
  - Read (`list_projects`, `list_factories`, `list_work_orders`, `get_work_order`, `list_order_plans`, `list_incidents`) need `supervisor:read`.
  - Write (`transition_work_order`, `transition_order_plan`, `resolve_incident`, `run_queue_action`, `import_todos`) need `supervisor:write`.
  - MCP gate is stricter than `resolve_incident` procedure (also accepts `factory:worker`).
- Tool args `{params?, query?, body?}` = contract shape; `inputSchema` from `z.toJSONSchema(io: input)`; execution reuses procedure Zod validation and scope checks.
- `tools/list` shows only tools the token may call.
- Errors:
  - Bearer missing/invalid 401, missing scope 403, `Origin` header 403, non-JSON content type 400, body over 1 MiB 413; standard `{code,type,message}` envelope.
  - Invalid JSON -32700, bad envelope -32600, unknown method -32601, unknown tool or bad args -32602, all HTTP 200.
  - Procedure failure (BaseError or code >= 400) returns result `isError: true`.
- Response header `Cache-Control: private, no-store`.
- Contract `packages/hq-contracts/src/mcp.contract.ts`: envelope schema, protocol version, JSON-RPC error codes.
- Tests: `apps/hq/test/blackbox/mcp.test.ts` (real in-memory SQLite); route index lists 27 endpoints.
- `apps/web/vitest.config.ts`: `testTimeout` 15s. Work-order web tests hit the 5s default under turbo load (passes standalone); keeps `ci:verify` green.
