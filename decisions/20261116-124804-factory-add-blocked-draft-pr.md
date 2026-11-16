---
scope: factory/cell
summary: Publish a draft [BLOCKED] PR when a Work order stops on an Andon
why: v1 published a [BLOCKED] draft PR for blocked work; v2 never did, so blocked changes stayed local
date: 2026-11-16
tags: [cell, andon, pr, blocked, github, supervisor]
---

- A supervisor-held Andon (escalated, or its incident recorded) gets one `publish_blocked` job per Andon, claimed while the supervisor holds it.
  - Row 3 of `nextJob` returns it until `blockedPr` names that Andon; after any outcome the Andon waits for the Supervisor, so nothing loops.
- The job reports `ReportBlockedPr{published | no_changes | failed}`, recorded as `blocked_pr_reported` in `blockedPr`.
  - Phase, Andon and holder stay as they were: the report never resolves the Andon.
- The Cell stages the worktree and compares the index with `origin/<baseBranch>`. No change means no commit, push or PR.
- Changes go out as a WIP commit on `factory/<todoId>`, pushed with `--force-with-lease` on the tip origin holds.
- The `[BLOCKED] <taskId> <reason>` title and body come from `.factory/templates/pr/blocked.md`; an open PR for the branch is updated, else a draft is created.
- Any failure is reported as `failed` with its detail. The job does not throw for it, and never sends a delivery report.
- Delivery reuses the branch's open PR: it takes the delivery title and body, and is marked ready.
- A supervisor resume is refused while the publish runs, so the report always finds its Andon.
- Not done: `factory show` and `factory status` do not display `blockedPr`; the projection has no column for it.
