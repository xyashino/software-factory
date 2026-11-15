---
scope: factory
summary: Server is a pure store with tasks and state only
why: Cells do repository and GitHub work; the server records state and PR webhooks
date: 2026-11-15
tags: [server, passive, webhook, reaper, intake, definitions]
---

- The server is a pure store: tasks, Order Plans, events, leases, blobs and PR state.
  - It answers requests and runs no polling loop.
  - It never calls `git` or `gh`, and never reads a repository's `lines/`, `operators/`, `templates/` from disk.
  - Startup loads only the bundled runtime prompts from `factory-definitions`.
- Cells do all repository, rendering and GitHub work, in each repository with its `.factory/` and `.nitpick/`.
- Intake is removed: `intake.ts`, `factory sync`, `/v1/intake/sync`, the git mirror and the PR-state `gh` adapter.
  - Work orders and plans come in through `POST /v1/orders` and `POST /v1/plans`, each with its pinned `LineSnapshot`.
  - Generated migration `0001_drop_intake` drops the `intake` table. Nothing reads it, and idempotency lives in `commands`.
  - Project removal no longer checks intake rows.
  - `admin recover`, the rebuild from git, goes with it. Recovery is the export, snapshot or replica (STORAGE §7).
- No background timers. `FACTORY_REAPER_MS`, `FACTORY_PR_POLL_MS` and `FACTORY_INTAKE_POLL_MS` are removed.
  - Expired leases are reaped lazily inside `claim`, `heartbeat`, and the board and order reads, with the same write semantics.
  - `Runtime.start` only arms boot grace: every lease gets a full TTL, and nothing is reaped until it passes.
  - The Cell's `hello` no longer carries `reaperMs`.
- PR state arrives by `POST /v1/webhooks/github`, outside bearer auth.
  - Verified by `X-Hub-Signature-256`: HMAC-SHA256 of the raw body with `GITHUB_WEBHOOK_SECRET`, constant-time compare.
  - A bad signature is `401`. An unset secret is `503 not_configured`, a new wire code.
  - `opened` and `reopened` record `open`. `closed` records `merged` or `closed` by its `merged` flag.
  - The state goes to every Work order and Order Plan whose `prUrl` matches. The delivery id is the command id.
  - A stream already at that state is left alone, so no second `pr_state_changed` is appended.
- R1 (portable queue) is met by export and import (STORAGE §7). The rebuild from git is dropped from PLAN, STORAGE §8, PROTOCOL and the restore runbook.
