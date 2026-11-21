---
scope: factory
summary: Remove local deploy assets from the repository
why: deploy runbook and systemd units are not wanted in this repo
date: 2026-11-21
tags: [deploy, cleanup]
---

- `deploy/`: removed, including systemd units, Litestream example and `RESTORE.md`.
- No code or test referenced `deploy/`; `RESTORE.md` pointed to a test file that does not exist.
