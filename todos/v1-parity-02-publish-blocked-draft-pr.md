---
status: todo
priority: medium
depends_on:
  - v1-parity-01-adopt-live-panes-on-restart
line: feature
factory: v2
plan: v1-ux-parity
type: feat
---

# v1-parity-02-publish-blocked-draft-pr: Publish a `[BLOCKED]` draft PR when a Work order enters an Andon with changes

## 🎯 Objective

Bring back v1's `publishBlockedWork` behavior so that when a Work order hits a blocking Andon and has local/branch changes relative to its base branch, a Cell publishes a `[BLOCKED]` draft PR on GitHub for human inspection.

---

## 🌐 Context & Problem Statement

In v1 (`packages/software-factory/src/supervisor/blocked-work.ts`), whenever a task blocked with changes against `origin/<baseBranch>`, the supervisor pushed the branch and opened a draft PR titled `[BLOCKED] <taskId> <reason>` using `templates/pr/blocked.md`.

In v2, `.factory/templates/pr/blocked.md` and `GithubPort.createPr({ draft: true })` already exist, and `apps/cell/src/adapters/github/__tests__/github.adapter.test.ts` even has `[BLOCKED]` test cases, but the runtime/Cell flow never creates a `[BLOCKED]` draft PR when an Andon is raised (especially after Mechanic escalation or `cycle_blocked`).

---

## 📦 Specification / Scope

- **Target**:
  - `packages/factory-core/src/order/` (`events.ts`, `commands.ts`, `state.ts`, `decide-control.ts`, `evolve-control.ts`, `next-job.ts`, `projection.ts`)
  - `packages/factory-core/src/contracts/` (`job.ts`, `routes.ts`)
  - `packages/factory-runtime/src/` (`job-builder.ts`, `pr-body.ts`)
  - `apps/cell/src/jobs/` (`deliver.ts` or new `publish-blocked.ts`, `render.ts`, `run-job.ts`)
  - `apps/cli/src/render/` (`board.ts`, `order.ts`)
- **Classification**: `Domain Core` / `Integration`
- **Dependencies**:
  - Reuses existing `GithubPort` (`apps/cell/src/ports/github.port.ts`) and `.factory/templates/pr/blocked.md`.

---

## 🛠️ Implementation Plan

1. **Domain Contract for Blocked PR (`packages/factory-core`)**:
   - Add an optional `blockedPrUrl` (or `blockedDelivery`) field on `WorkOrderState` and event `blocked_pr_published { prUrl, commit }` (via command `ReportBlockedPr`), without transitioning `phase` away from the active Andon (`holder: 'supervisor'`).
   - Optionally schedule a short `publish_blocked` job (or perform best-effort during `BlockCycle` / after Mechanic escalation when `andon.triage === 'supervisor'` and changes exist), ensuring `nextJob` does not loop if blocked PR publication fails (best-effort, non-blocking).
2. **Cell Execution & Rendering (`apps/cell`)**:
   - Check if the worktree/branch has diff/uncommitted changes relative to `origin/<baseBranch>`. If empty, skip PR creation.
   - Render `.factory/templates/pr/blocked.md` with `taskId`, `reason`, `detail`, and `logCommand`.
   - Commit WIP (if uncommitted), push `factory/<todoId>` (with `--force-with-lease`), and call `github.findPr` / `github.createPr({ draft: true, title: '[BLOCKED] ...', body })` (or `updateBody` if a draft PR already exists).
   - Never fail the Andon if GitHub fails; record the diagnostic in Cell logs and continue waiting for Supervisor `resume`/`cancel`.
3. **Delivery & Resume Compatibility**:
   - When the Work order is later resumed and reaches `deliver`, `deliverWorktree` reuses the existing open PR (updating body/title and marking ready if draft).
   - Display `blockedPrUrl` in `factory show` / `factory status`.

---

## ✅ Acceptance Criteria

- [ ] When a Work order is escalated to Supervisor (`andon` with code changes vs base), a draft PR titled `[BLOCKED] ...` rendered from `.factory/templates/pr/blocked.md` is opened (or updated) on GitHub.
- [ ] Orders blocked with zero diff vs base do not create empty `[BLOCKED]` PRs.
- [ ] GitHub API / push errors while publishing a `[BLOCKED]` PR are logged best-effort and never mask or corrupt the Andon state.
- [ ] Resuming and delivering a previously `[BLOCKED]` order updates/reuses the PR cleanly and marks it ready.
- [ ] Passes verification gate (`pnpm ci:verify`).
