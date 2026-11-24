---
status: queued
priority: high
line: feature
type: feat
---

# hq-mcp-server: add Streamable HTTP MCP server endpoint to HQ

## Objective

Expose HQ supervisor operations over a Streamable HTTP JSON-RPC 2.0 MCP endpoint (`POST /api/v1/mcp`) so AI clients (Claude, Cursor, Antigravity) can inspect queues, activate plans, import todos, and resolve Andon incidents directly.

## Context

Inspired by `gon-stack/apps/parka/src/server/mcp/http.ts`. Today supervisors operate HQ via `sf` CLI or raw HTTP. Reusing HQ's existing `safe_tokens` (`supervisor:read`, `supervisor:write`) lets any MCP-capable client interact safely without new credential types.

## Scope

- **Target**: `apps/hq/src/adapters/hono/routes/mcp.route.ts`, `apps/hq/src/app.ts`, `apps/hq/src/application/mcp`, `packages/hq-contracts`, `apps/hq/test/blackbox`
- **Classification**: `Feature`, `Backend`, `Integration`

## Implementation Plan

1. **MCP Transport (`apps/hq/src/adapters/hono/routes/mcp.route.ts`)**:
   - Implement stateless Streamable HTTP JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`) with `Origin` check, 1 MiB body limit, and `Cache-Control: private, no-store`.
   - Authenticate with existing bearer token middleware; enforce `supervisor:read` for read tools and `supervisor:write` for mutating tools.
2. **Supervisor Tool Set (`apps/hq/src/application/mcp/`)**:
   - Read tools: `list_projects`, `list_factories`, `list_work_orders`, `get_work_order`, `list_order_plans`, `list_incidents`.
   - Write tools: `transition_work_order`, `transition_order_plan`, `resolve_incident`, `run_queue_action`, `import_todos`.
   - Validate tool arguments with Zod schemas from `@repo/hq-contracts`.
3. **Tests**:
   - Add black-box HTTP tests in `apps/hq/test/blackbox/mcp.test.ts` covering `initialize`, `tools/list`, read/write tool execution, scope enforcement (`403`), and invalid JSON-RPC payloads.

## Acceptance Criteria

- [ ] `POST /api/v1/mcp` handles `initialize`, `tools/list`, and `tools/call` per Streamable HTTP JSON-RPC 2.0.
- [ ] Read-only tokens (`supervisor:read`) can call read tools and get `403` on write tools.
- [ ] All tool inputs validate through `@repo/hq-contracts` Zod schemas.
- [ ] Black-box tests pass with real in-memory SQLite HQ.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
