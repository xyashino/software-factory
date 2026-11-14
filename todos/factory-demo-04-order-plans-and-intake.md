---
status: todo
priority: medium
depends_on: [factory-demo-03-board-and-orders]
line: feature
factory: v2
plan: factory-demo
---

# factory-demo-04: Order Plans chain view and Intake sync panel

## Objective

Build `plans` and `intake` modules in `apps/factory-demo` to inspect stacked Order Plans and trigger project Intake syncs with diagnostics.

## Read first

- `docs/ORDER-PLAN.md` (§2, §3, §4, §6)
- `packages/factory-core/src/contracts/supervisor.ts` (`planRowSchema`, `planMemberSchema`, `planDetailResponseSchema`, `intakeSyncRequestSchema`, `intakeSyncResponseSchema`)
- `apps/cli/src/commands/plan.ts`, `apps/cli/src/commands/sync.ts`
- `.agents/references/frontend-architecture.md`
- `.agents/rules/ui.md`, `.agents/rules/ux.md`, `.agents/rules/msw-backend-mocks.md`

## Deliverables

1. **`src/modules/plans/`:**
   - Follow `frontend-architecture.md` (`configuration/`, `domain/`, `core/`, `integration/`, `presentation/`).
   - Plans list: `slug`, `projectId`, `branch` (`feat/<slug>`), `phase`, `memberCount`, `prState`, `prUrl`, `andonReason`.
   - Plan detail panel: visual linear chain `WO_1 -> WO_2 -> WO_3` in dependency order with each member's `todoId`, `state`, `status`, resolved `baseBranch` (`feat/<slug>` vs `factory/<pred>`), `prUrl`, and `blocker` badge, plus plan PR link and Andon notice.
   - Skeleton loading, non-hiding reload banner, empty state (`icon:title:description:primary-action`), error pattern.
2. **`src/modules/intake/`:**
   - Intake sync trigger bar/view: run `POST /api/intake/sync` for all projects or one selected `projectId`.
   - Button spinner (`ux-spinner`), toast on completion, and structured `IntakeReport` summary per project (`commit`, `created`, `updated`, `cancelled`, `specDrift` counts + `diagnostics` list showing `todoId`, `kind`, `message`).
   - Trigger board/plans refresh after successful sync.
3. **Tests & ADR:**
   - Black-box AAA tests with `msw` covering plans list, empty/error states, chain detail with member blockers/PRs, and intake sync report + diagnostics.
   - One `decisions/` ADR entry.

## Scope guardrails

- Do not implement Cells, Join Tokens, Projects CRUD, or Admin tools (WO 5).

## Acceptance criteria

- [ ] `Plans` and `Intake` tabs integrate cleanly into `AppShell` navigation and live refresh.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test`, and `pnpm --filter @repo/factory-demo build` pass.
