---
scope: factory
summary: Add sf order test to queue a smoke-test order
why: Operators need one command to verify a Cell runs a job and opens a PR without a todos file
date: 2026-11-24
---

- `sf order test [--line <name>] [--slug <slug>] [--json]` posts a smoke-test `chore` order to `POST /api/v1/work-orders`.
- Project id comes from `.factory/config.json`; line defaults to `fast`; slug defaults to `smoke-test-<epoch seconds>`.
- Priority is `high`; title is `Smoke test runner and PR delivery`.
- Order description tells the builder to add only the `decisions/` entry, write report and commit message files, and run `sf operator done`.
- Text output prints `<orderId> <state> line=<line> priority=<priority>`; `--json` prints `{ order }`.
- No `todos/*.md` file is written and no HQ or contract change is made.
- Tests: unit procedure tests and blackbox CLI tests against a fake HQ.
