---
scope: factory/sf
summary: Add sf plan reset to restart an order plan from scratch
why: Plans in active, ready or completed state could not run again, and the plan branch push failed on re-run
date: 2026-11-24
---

- New plan action `reset`: `active`, `ready`, `completed`, `failed` move to `branching`. `draft`, `branching`, `cancelled` answer 409.
- Same transaction: in-flight jobs of non-delivered children are cancelled, children go to step 0 and to `queued` or `waiting_parent`.
- `delivered`, `completed`, `cancelled` children are unchanged and listed as `skipped`. No auto-reopen.
- `paused` children stay `paused`. Unavailable-line list and active job/cell/factory pins are cleared.
- One new `plan_branch` job with `payload.fresh = true`.
- Fresh plan branch pushes `--force-with-lease` on the remote sha read by `ls-remote`. Normal plan branch push is unchanged.
- Old `feat/<plan-slug>` commits stay in the remote reflog only.
- `sf plan reset <slug> --yes`: without `--yes` it fails with an argument error and sends no request.
- Response prints `reset <slug> <state>` and `skipped <slug> <state>` lines (or `--json`).
- Blackbox tests drive `sf plan reset` against a fake HQ. HQ tests cover the state rule, the cascade and the fresh job.
- `docs/sf.md` command table and `docs/hq.md` section 6.3 describe the flow.
