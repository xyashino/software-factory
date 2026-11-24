---
scope: factory/sf
summary: Add sf plan list, show, activate and retry commands
why: Operators hand-wrote HQ curl calls to activate plans, and the sf CLI had no plan group
date: 2026-11-24
---

- New `sf plan` group: `list`, `show <slug>`, `activate <slug>`, `retry <slug>`.
- Project comes from the repo config, as `sf queue` does.
- `list` and `show` read `GET /api/v1/order-plans`; `show` prints `state`, `branchCommitSha`, `failureDetail` (or `--json`).
- `activate` and `retry` resolve the slug to a plan id, then `POST /api/v1/order-plans/{id}/transitions` with `activate` or `retry`.
- Unknown slug fails with an argument error before any transition is sent.
- HQ keeps the state rules: `activate` only from `draft`, `retry` only from `failed`.
- Blackbox test drives each command against a fake HQ.
- `docs/sf.md` command table lists the four commands.
