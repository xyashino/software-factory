---
scope: factory
summary: Pin sf exit-code contract with unit test
why: scripts and agents rely on EXIT values; nothing guarded them
date: 2026-11-21
tags: [test]
---

- Added `apps/factory/test/unit/domain/exit-codes.test.ts`: `ok` 0, `refused` 1, `argument` 2, `unreachable` 3, all distinct.
- No source change.
