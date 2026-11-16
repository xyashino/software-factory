---
status: todo
priority: medium
depends_on: []
line: feature
factory: v2
plan: v1-ux-parity
type: feat
---

# v1-parity-01-adopt-live-panes-on-restart: Adopt live Herdr Operator panes across `factory-cell` restarts

## 🎯 Objective

Restore v1's `reconcile` capability in `apps/cell` so that when `factory-cell` restarts while an interactive Herdr Operator pane is still running, the Cell re-adopts the live pane (and its `factory-operator` endpoint) instead of losing in-flight LLM work.

---

## 🌐 Context & Problem Statement

In v1 (`packages/software-factory/src/supervisor/reconcile.ts`), `reconcileTask` checked `ports.herdr.exists(agentName(...))` on startup and re-attached to any still-running Herdr pane, only marking vanished panes as `crashed`.

In v2 (`apps/cell`), restarting `factory-cell` loses in-memory `createJobRegistry()` / `createRegistry()` state and ephemeral `operator-socket` servers. Any live pane either becomes orphaned until the 60 s server lease expires (`job_lost{lease_expired}` → `cycle_failed{lost}`) or cannot reach its `FACTORY_OPERATOR_ENDPOINT`, forcing a full station restart from scratch.

---

## 📦 Specification / Scope

- **Target**:
  - `apps/cell/src/cell.ts`, `apps/cell/src/main.ts`
  - `apps/cell/src/operator-socket.ts` (or HTTP operator endpoint)
  - `apps/cell/src/jobs/run-operator-station.ts`
  - `apps/cell/src/runners/herdr-pane.ts` & `apps/cell/src/ports.ts`
  - `apps/cell/src/cycle/` (session persistence / reconcile module)
- **Classification**: `Integration` / `Infrastructure`
- **Dependencies**:
  - No new external packages.

---

## 🛠️ Implementation Plan

1. **Persist Active Pane Session Metadata**:
   - Under `<cellDataDir>/cycles/<cycleDir>/session.json`, persist minimal local metadata when a non-headless Herdr pane opens: `orderId`, `jobId`, `cycleId`, `epoch`, `stationId`, `paneName`, `taskName`, `operatorToken`, `operatorPort` (or socket path), `worktree`, `startedAt`.
   - Remove `session.json` cleanly when the Cycle ends, is fenced, or is aborted.
2. **Startup Reconciliation in `apps/cell`**:
   - Before entering `runClaimLoop` (or when claiming/resuming a job whose lease is still held by this Cell's `cellId` or whose `session.json` exists):
     - Probe the Herdr pane via `pane.read(paneName)` / `herdr.exists(paneName)`.
     - If the pane is `'gone'` or the server already moved the epoch (`stale` / lease lost), clean up `session.json` and close any leftover stale pane.
     - If the pane is still live AND the local Cell credential/lease is still valid for `(orderId, jobId, epoch)` (or during boot grace / same-Cell restart):
       - Re-bind the local operator listener on the same port/socket with the persisted `operatorToken` so `factory-operator` inside the live pane continues to work seamlessly.
       - Resume the `observePane` + `watch` loop and re-register the job in `JobRegistry` so `heartbeat` keeps extending the lease.
3. **Orphan Cleanup**:
   - Add tests with a fake `PaneDriver` and restart cycle verifying both paths: live pane re-adoption (preserving `cycleId` and completing via `factory-operator done`) and dead pane cleanup.

---

## ✅ Acceptance Criteria

- [ ] Non-headless Herdr Operator cycles persist `session.json` under `<cellDataDir>/cycles/` and delete it on clean completion/abort.
- [ ] Restarting `factory-cell` while a pane is alive and its lease is still valid re-attaches the operator listener, `JobRegistry`, and `observePane` loop without killing the running agent.
- [ ] If the pane is gone or the lease expired while `factory-cell` was down, stale `session.json` state is cleaned up safely without blocking new claims.
- [ ] Passes verification gate (`pnpm ci:verify`).
