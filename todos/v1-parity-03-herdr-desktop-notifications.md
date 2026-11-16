---
status: todo
priority: medium
depends_on:
  - v1-parity-02-publish-blocked-draft-pr
line: feature
factory: v2
plan: v1-ux-parity
type: feat
---

# v1-parity-03-herdr-desktop-notifications: Restore Herdr desktop toast notifications for questions, blocks, and deliveries

## 🎯 Objective

Wire `HerdrPort.notify` into the v2 Cell / CLI runtime so human operators receive desktop toast notifications (with sound hints) when an Operator asks a question, an order hits an Andon / `[BLOCKED]` PR, or a PR is delivered.

---

## 🌐 Context & Problem Statement

In v1 (`packages/software-factory/src/supervisor/notify.ts`), `notifyQuietly` invoked `ports.herdr.notify(title, { body, sound })` for key human-in-the-loop moments (`Task Blocked`, open questions, `Task Delivered`), logging any refusal to disk without throwing.

In v2, [`HerdrPort.notify`](file:///home/xyashino/Documents/software-factory/apps/cell/src/ports/herdr.port.ts#L12) is already implemented and unit-tested in `apps/cell/src/adapters/herdr/`, yet no production code in `apps/cell`, `apps/server`, or `apps/cli` calls it.

---

## 📦 Specification / Scope

- **Target**:
  - `apps/cell/src/ports.ts` (`PaneDriver` or dedicated `NotifyPort`)
  - `apps/cell/src/runners/herdr-pane.ts` & `apps/cell/src/adapters/herdr/`
  - `apps/cell/src/jobs/` (`run-operator-station.ts`, `deliver.ts`, blocked-PR flow)
  - `apps/cell/src/config.ts` (optional `notifications: boolean` toggle, defaulting cleanly when a Herdr pane driver is active)
- **Classification**: `Integration`
- **Dependencies**:
  - Reuses existing `HerdrPort.notify` / `createHerdrAdapter`.

---

## 🛠️ Implementation Plan

1. **Expose `notify` cleanly to Cell Jobs**:
   - Add an optional `notify?: (title: string, options?: HerdrNotificationOptions) => Promise<void>` callback on `JobContext` (and `StationDeps`), backed by `herdr.notify` when `herdr` is enabled and a no-op in headless/test environments without Herdr.
   - Implement a `notifyQuietly` helper that catches and logs errors without ever failing a Cycle, Andon, or Delivery.
2. **Trigger Notifications at Key Lifecycle Events**:
   - **Open Question (`AskQuestion`)**: when an Operator invokes `factory-operator ask`, emit a toast with `sound: 'request'` naming the `<todoId>` and question summary.
   - **Andon / Blocked (`andon` / `[BLOCKED]` PR)**: emit a toast with `sound: 'request'` naming the `<todoId>`, reason, and `[BLOCKED]` PR URL (if published).
   - **Delivery (`ReportDelivery{finished}`)**: emit a toast with `sound: 'done'` naming `<todoId>` and the opened PR URL.
3. **Configuration & Tests**:
   - Support disabling notifications via `CellConfig` / env (e.g. `FACTORY_NOTIFY=0`) for remote/headless VPS Cells.
   - Add unit tests verifying best-effort error swallowing and expected titles/sounds for question, block, and delivery events.

---

## ✅ Acceptance Criteria

- [ ] Interactive Herdr Cells emit desktop toast notifications on Operator questions (`sound: 'request'`), blocks/Andons (`sound: 'request'`), and successful PR deliveries (`sound: 'done'`).
- [ ] Headless / VPS Cells or failed `herdr notify` calls never fail or delay any job (`notifyQuietly` swallows and logs errors).
- [ ] Notifications can be toggled off in Cell config/environment.
- [ ] Passes verification gate (`pnpm ci:verify`).
