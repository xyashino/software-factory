---
scope: factory
summary: Gone Cell deletes row, tokens and unlocks its order in one tx
why: A gone Cell must leave no row, no token and no locked order. Silent Cells and dead Factories would otherwise keep state and block claims
date: 2026-11-22
tags: [factory, cell, hq, gone, reaper, migration]
---

- `goneCell(tx, cellId, now, actor, log)` in `procedures/cells/gone-cell.ts`, idempotent:
  - claimed or running job: `loseJob` (job `lost`, order `queued`, epoch + 1, Cell released)
  - clears `work_orders.pinned_cell_id` of that Cell
  - deletes its `safe_tokens`, then its `cells` row
- Caller 1: `POST /api/v1/factories/cells/:id/gone` (`factory:worker`). Owning Factory only: unknown Cell 200, foreign or join-enrolled Cell 403.
- Caller 2: reaper, in every claim and heartbeat tx, after expired jobs are lost:
  - Cell with `lastHeartbeatAt + LEASE_TTL_MS <= now` (any status) is gone
  - Factory with `lastSeenAt + LEASE_TTL_MS <= now` has every owned Cell gone
  - reaper no longer sets `offline`; enum kept for drain
- Claim sets the caller's `lastHeartbeatAt` before reap, so an idle Cell in the long-poll stays alive.
- Migration `0004_cell_gone`: `jobs` rebuilt without FK on `cell_id`, so job history keeps a gone Cell id. `pinned_cell_id` and tokens keep their FK and are cleared or deleted in code.
- Factory daemon: `DELETE /cells/:id` kills and confirms exit, then calls HQ gone with the Factory credential. HQ failure is ignored; the reaper deletes the Cell after `LEASE_TTL_MS`.
- Cell deletion never bumps `worktree_resets`.
- `revoke` and `leave` share `unpinOrders` and `loseActiveJob` from `orders/cell-release.ts`.
- Accepted risk: reaper deletes a silent Cell of a live Factory. A hung process may still run. Follow-up: Factory heartbeat reply lists Cells HQ wants killed.
- Known gap: a `ready` mechanic job pinned to a gone Cell is not re-targeted.
