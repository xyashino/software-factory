---
status: todo
priority: medium
depends_on: [factory-demo-03-board-and-orders]
line: feature
factory: v2
plan: factory-demo
---

# factory-demo-04: Order Plans chain view

## Objective

Build `plans` module in `apps/factory-demo` to inspect stacked Order Plans, chain dependencies, member PRs, and Andon notices.

## Read first

- `docs/ORDER-PLAN.md` (§2, §3, §4, §6)
- `packages/factory-core/src/contracts/supervisor.ts` (`planRowSchema`, `planMemberSchema`, `planDetailResponseSchema`)
- `apps/cli/src/commands/plan.ts`
- `.agents/references/frontend-architecture.md`
- `.agents/rules/ui.md`, `.agents/rules/ux.md`, `.agents/rules/msw-backend-mocks.md`

## Deliverables

1. **`src/modules/plans/`:**
   - Follow `frontend-architecture.md` (`configuration/`, `domain/`, `core/`, `integration/`, `presentation/`).
   - Plans list: `slug`, `projectId`, `branch` (`feat/<slug>`), `phase`, `memberCount`, `prState`, `prUrl`, `andonReason`.
   - Plan detail panel: visual linear chain `WO_1 -> WO_2 -> WO_3` in dependency order with each member's `todoId`, `state`, `status`, resolved `baseBranch` (`feat/<slug>` vs `factory/<pred>`), `prUrl`, and `blocker` badge, plus plan PR link and Andon notice.
   - Skeleton loading, non-hiding reload banner, empty state (`icon:title:description:primary-action`), error pattern.
   - Refresh plans list/detail on live `/api/stream` updates.
2. **Tests & ADR:**
   - Black-box AAA tests with `msw` covering plans list, empty/error states, and chain detail with member blockers/PRs.
   - One `decisions/` ADR entry.

## Scope guardrails

- Do not implement Cells, Join Tokens, Projects CRUD, or Admin tools (WO 5).

## Acceptance criteria

- [ ] `Plans` tab integrates cleanly into `AppShell` navigation and live refresh.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test`, and `pnpm --filter @repo/factory-demo build` pass.
