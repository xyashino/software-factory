---
scope: factory
summary: Run delivery git checks once, not again through the hooks
why: Delivery ran the full test suite at the commit and again at the push, and a refused push failed the Work order.
date: 2026-11-17
tags: [factory, cell, delivery, hooks, nitpick]
---

- Delivery commits and pushes with `--no-verify`. The quality gate already ran the hook's checks (`ci:verify`) on the tree being delivered.
- Delivery checks the commit message itself with the rich-commit rule (`validateRichCommit`), since skipping the hook also skips the `commit-msg` check.
- `apps/cell` depends on `@repo/nitpick` for that rule.
