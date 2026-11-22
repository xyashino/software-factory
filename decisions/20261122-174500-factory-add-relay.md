---
scope: factory
summary: Cells talk only to the Factory daemon, which relays to HQ
why: A Cell must hold no HQ URL or credential. The Factory holds the only HQ credential, so Cell auth is local and HQ learns which Factory owns each Cell
date: 2026-11-22
tags: [factory, cell, relay, enroll, security, hq]
---

- Cell env:
  - `FACTORY_URL` = `http://127.0.0.1:<daemon port>/relay`
  - `FACTORY_TOKEN` = random 32-byte local token (in memory only, one per Cell run)
  - `FACTORY_JOIN_TOKEN` blank
  - No HQ URL, HQ token, supervisor token or join token reaches a Cell.
- Relay lives on the daemon listener under `/relay`, loopback only. Local token maps to `{cellId, hq name, HQ session}` in memory. Token dies when the Cell leaves the supervisor (exit or kill).
- Enroll intercept: `POST /relay/api/v1/cells/enroll` calls HQ enroll with the Factory credential, name `cell-<8 hex>` (random, not the Cell name). Returns `{cellId, sessionToken: <local token>, expiresAt}` 201.
- Allowlist (POST only, else 403 before auth): `cells/{enroll,hello,claims,heartbeats,leave}`, `jobs/:id/transitions`, `incidents/:id/resolve`. Unknown or dead local token: 401.
- Forward: `authorization` replaced by the HQ session, response streamed back, timeout = `REQUEST_TIMEOUT_MS + waitMs`.
- Upstream 401 on a Cell session: re-enroll once (same name, Factory credential), retry once. Second 401: kill that Cell, 401 to it. Factory credential 401 during enroll: kill that Cell, 401.
- Cell start: relayed (`SF_FACTORY_PID` set) keeps the session in memory, never reads `.factory-local/cells/<name>.json`, enrolls with its local token as bearer, skips project listing and trusts repo config. Non-relayed path unchanged.
- HQ: `cells.factory_id` nullable (migration `0003_cell_factory_owner`).
  - Enroll accepts `factory:worker`; the calling Factory is read from the token row and stored on the cell and its session token.
  - Join-token enrolls leave it null.
  - `GET /api/v1/cells` returns `factoryId`.
- Chosen: blank `FACTORY_JOIN_TOKEN` in the Cell env so a join token inherited from the daemon env never reaches a Cell. Chosen: relay checks the allowlist before auth, so a foreign route is 403 regardless of token.
- Out of scope: per-Cell HQ rows and tokens (`cell-identity-slim`), gone-Cell transaction, shared long-poll.
