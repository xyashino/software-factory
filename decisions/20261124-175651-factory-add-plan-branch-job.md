---
scope: factory/sf
summary: Run plan branch jobs and start worktrees from origin
why: Plan branches exist only on origin, so jobs had no line and git worktree add failed on the unknown local ref
date: 2026-11-24
---

- Cell runs `plan_branch` jobs before the line lookup in `runJob`.
- Fetch `origin <baseBranch>`, push its commit to `refs/heads/<targetBranch>`, then complete the job with that SHA.
- HQ completion already sets the plan `active` and unlocks its root work orders, so no HQ change.
- Push failure fails the job with `plan branch failed: <git error>`.
- `worktreeAdd` checks for a local `refs/heads/<base>`; when absent it starts from `origin/<base>`. Local base branches keep their current start point.
- Unit tests cover the plan branch success path, a rejected push, and the origin-only base; existing git worktree tests expect the check call.
