---
scope: factory/cell
summary: Write cell step files atomically, completion marker last
why: A kill mid-write left truncated files and a complete marker without its commit
date: 2026-11-22
tags: [cell, reliability, fs]
---

- `writeText` writes `<path>.tmp-<pid>` then renames; mode set explicitly. Applies to all callers.
- `state.json` (complete marker) written only after checkpoint commit and sha known.
- Step start removes that station's `state.json` and `feedback.md` from earlier attempts.
- Worktree reuse removes leftover `*.tmp-*` under `.cell/`, mechanic and station dirs.
- New `FsPort.remove` (force, missing file ok).
- Tests: adapter write/remove; run-job checkpoint-fail leaves no marker; restart drops old markers; reuse drops staged files.
- `bun run ci:verify` passes (41/41 tasks); `apps/sf` tests 697 pass, 8 skipped.
