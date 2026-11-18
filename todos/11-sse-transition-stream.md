---
status: todo
factory: v2
plan: cells-jobs-incidents
depends_on: [10-incidents-resolve-procedure]
priority: medium
line: feature
type: feat
---

# Todo: `11-sse-transition-stream` — Real-Time SSE Transition Stream

## 🎯 Objective

Stream `state_transitions` to supervisors over SSE, with backlog replay and live events, per `PLAN.md` §9.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/adapters/hono/routes/stream.route.ts`, `apps/factory-server/src/contracts/stream.contract.ts`, `apps/factory-server/test/blackbox/stream.test.ts`
- **Boundary**: `apps/factory-server/` only.
- **Classification**: `Integration`
- **Dependencies**: `hono: catalog:`, `drizzle-orm: catalog:`

---

## 🛠️ Implementation Plan

1. `GET /api/v1/stream?projectId=<id>&afterSeq=<seq>`, scope `supervisor:read`. Authenticate with `ctx.auth`.
2. Emit backlog rows where `seq > afterSeq` (filtered by `projectId` when given) as `event: transition`, `id: String(row.seq)`, JSON `data`.
3. Subscribe to `ctx.transitionBus` for live events in order. Send `: keepalive` comments periodically.
4. Stop cleanly when `c.req.raw.signal` aborts.

---

## ✅ Acceptance Criteria

- [ ] `afterSeq` replays the backlog in `seq` order, then live events follow.
- [ ] `projectId` filter excludes other projects.
- [ ] Aborting the request unsubscribes from the bus.
- [ ] No `any` and no loose type assertions.
- [ ] `pnpm --filter @repo/factory-server-v2 test check-types lint` passes.
