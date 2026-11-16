---
scope: factory/cell
summary: Defer cell commits and pushes to deliver; reset on missing worktree
why: Per-station WIP commits and pushes were squashed away at delivery anyway
date: 2026-11-16
tags: [cell, factory-core, workspace, checkpoint, delivery, worktree]
---

- No Station commits and no pushes before `deliver`. A checkpoint validates outputs, uploads blobs, reads the worktree HEAD, dry-runs the command, then sends it.
  - `checkpoint()` no longer runs `git commit` or `git push`, and a failed Cycle pushes no `factory-wip/*` ref.
- Uncommitted work lives in `<repo>/.worktrees/<todoId>/` across Stations, retries and restarts. `.cell/` stays git-excluded; the server blobs and the Traveler are the only inter-Station channel.
- Each workspace job carries `workspace.mode`:
  - `fresh` places the worktree at the base (`checkout --force`, `clean -fd`) and writes `.cell/worktree.json`. Used for Station 0 and for a job resuming from a named commit.
  - `reuse` fetches origin and keeps the worktree as it is: no `sync`, no checkout, no clean. Used for every other Station job, retry, restart and delivery.
- A `reuse` job whose worktree is not on the Cell reports `ReportWorktreeMissing`: no Cycle, no `setup`.
  - `worktree_missing` returns the Work order to Station 0, clears the checkpoint and per-Station attempt counters, keeps lifetime retries, and raises `worktreeResets`.
- `nextJob` raises the `workspace_failed` Andon once `worktreeResets` reaches `MAX_WORKTREE_RESETS` (2) without a delivery. A delivery or a Supervisor `resumed` or `reopened` clears the counter.
- Read-only checks compare fingerprints, not `git status`: porcelain status, diff against HEAD, and every untracked file's content, `.cell/` excluded.
  - A read-only Operator station takes its baseline after its inputs are written; an Inspection takes it before its checks run. Each fails only when the fingerprint changed.
- `deliver` runs in `reuse`: it stages the worktree, commits the staging on HEAD, rebases on `origin/<baseBranch>`, squashes to one commit, then dry-runs and pushes `factory/<todoId>` with the lease.
  - A failed delivery before the push puts HEAD back on the commit the worktree started from, so origin never needs a commit only this Cell holds.
- Not done: queue affinity toward the Cell that holds the worktree. Without it, a Work order moved to another Cell resets to Station 0. The Mechanic still pushes its repair commits; it is out of scope here.
- Consequence: a Handover or Andon resumed on another Cell no longer continues the earlier Cell's uncommitted work; it restarts at Station 0 there. The reset guard bounds that loop.
