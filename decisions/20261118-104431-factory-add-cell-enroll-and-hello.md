---
scope: factory/server
summary: Cell enroll and hello with safe-token auth
why: Cells need to enroll with a join token and resume their active job after a fast reconnect.
date: 2026-11-18
tags: [factory, cells, auth]
---

- `POST /api/v1/cells/enroll` (scope `cell:enroll`) checks a `sf_join_` token, upserts the cell and returns an `sf_cell_` session token once.
- Session tokens last 30 days (`CELL_SESSION_TTL_MS`). Only the SHA-256 hash is stored.
- Cell id is derived from project and name, so re-enrolling updates the same cell row.
- `POST /api/v1/cells/hello` (scope `cell:worker`) refreshes project, lines, runners and local worktrees and stamps `last_heartbeat_at`.
- Hello resumes an unexpired `claimed` or `running` active job: bumps `epoch`, sets the lease to now + 60s and returns `resumedJob`.
- Hello reads expired leases without reaping them. Reaping stays in step-03.
- Safe-token auth hashes the bearer, rejects unknown, revoked and expired tokens and maps stored scopes. No rotation grace window yet.
- No endpoint mints join tokens yet; tests seed them directly.
