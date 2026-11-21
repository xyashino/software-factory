---
scope: factory
summary: Ignore local .notes directory in git
why: notes are machine-local scratch, not repo source
date: 2026-11-21
tags: [git, cleanup]
---

- `.gitignore`: add `.notes/`.
- `.notes/` stays on disk, untracked.
