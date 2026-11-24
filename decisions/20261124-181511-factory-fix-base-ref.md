---
scope: factory/sf
summary: Resolve the base ref to origin for diffs and ADR checks
why: Deliver and summary diffs used the remote-only plan base name, so the ADR check found 0 entries and failed the root order
date: 2026-11-24
---

- `baseRefOf` returns the local base name when it exists and `origin/<base>` otherwise.
- The worktree start point, the work summary diff and the ADR check all use it.
- Unit tests cover both branches of `baseRefOf`.
