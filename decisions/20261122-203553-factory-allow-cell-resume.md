---
scope: factory/cell
summary: Resume order worktree at head commit, else discard and restart
why: Killed station left dirty worktree; resume from last commit, discard when unusable
date: 2026-11-22
tags: [cell, resume, worktree, git, hq]
---

- Reuse job, existing worktree: `git reset --hard <headCommitSha>`, `git clean -fd` (never `-x`; `.cell/` survives). Log `worktree reset to <sha>`.
- Step > 0: missing `.cell/` file, head commit unknown to clone, or reset fails -> discard worktree + local branch, report `worktree_missing`. Missing worktree at step > 0 also reports.
- Step 0 `fresh`: discard, create from base. Step 0 `reuse`: resume, else discard and create.
- Discard = `worktreeRemove` (`--force`, falls back to `rm -rf` + `worktree prune`) then `deleteBranch factory/<slug>`. Branch must go too, else `worktree add -b` fails on recreate.
- New `GitPort.deleteBranch`.
- HQ: claimed job DTO carries `headCommitSha` = order head, else base commit.
- HQ: `worktree_missing` accepted from `claimed` (Cell reports before `start`), not only `running`.
- Not handled: remote `origin factory/<slug>` keeps old builder commits; plain push rejects after scratch restart. Needs force-push or remote delete decision.
- Tests: real-git black box (reset, clean, ignored `.cell/`, discard, branch recreate); run-job decisions via harness; HQ claim head commit and claimed `worktree_missing`.
