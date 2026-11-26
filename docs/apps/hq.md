# `@repo/hq` (`apps/hq`)

Stateful HQ control plane built on **Bun + Hono + Drizzle ORM (`bun:sqlite` WAL / Bun SQL Postgres) + Zod**.

- Terms: [glossary](../README.md#glossary)
- Code rules & layering: [engineering.md](../architecture/engineering.md)
- Business boundaries: [boundaries.md](../architecture/boundaries.md)
- Feature specs: [work-orders.md](../features/work-orders.md), [cells-and-factory.md](../features/cells-and-factory.md), [incidents.md](../features/incidents.md)

## 1. Core Responsibilities

1. **Project & Hierarchy Registry**: Stores `projects`, `order_plans`, `work_orders`, `order_steps`, `jobs`, `incidents`, `factories`, `safe_tokens`, and `state_transitions` (SSE history).
2. **Exclusive Claim & Lease Fencing**: Assigns at most 1 Cell per `WorkOrder` from Step 0 through `deliver` under `BEGIN IMMEDIATE` (SQLite) or `SELECT ... FOR UPDATE` (Postgres) with monotonic `epoch` fencing.
3. **Zero GitHub / Repo Coupling**: Never runs `git` or `gh`, never reads target repo files directly. Cells push branches, publish PRs, and report commits via REST.

## 2. Storage Engines & Exclusivity Indexes

- **Default SQLite (`HQ_DB_PATH`)**: WAL mode, `BEGIN IMMEDIATE` write transactions. Stored in `$HQ_DATA_DIR/hq.db` (falls back to `factory.db` if present).
- **Postgres (`HQ_DATABASE_URL`)**: Connects via Bun SQL when set to `postgres://...`. Embedded migrations (`apps/hq/src/db/pg/migrations`) run under advisory lock on startup.
- **Database-enforced exclusivity** (`apps/hq/src/db/schema`):
  - `idx_jobs_one_active_per_order`: At most 1 `claimed` or `running` Job per `WorkOrder`.
  - `idx_jobs_one_active_per_cell`: At most 1 `claimed` or `running` Job per Cell.
  - `idx_work_orders_one_active_per_cell`: At most 1 `WorkOrder` locked to a Cell via `active_cell_id`.

## 3. Safe Tokens

256-bit CSPRNG tokens, SHA-256 hashed at rest, verified via `crypto.timingSafeEqual`, 60s rotation grace window (`rotated_from_id`).

| Token Kind | Prefix | Issued By | Default TTL | Allowed Scopes | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `supervisor` | `sf_sup_` | `sf hq token admin create` or rotate API | 30d / configurable | `supervisor:read`, `supervisor:write`, `admin:tokens` | Manage plans, orders, incidents, queue import/export, mint join tokens |
| `factory_join` | `sf_join_` | Supervisor (`POST /api/v1/tokens`) | 15m - 24h (single-use) | `factory:enroll` | Exchanged once at `POST /api/v1/factories/enroll` for `factory_session` |
| `factory_session` | `sf_factory_` | HQ on Factory enroll or rotate | 7d rolling | `factory:worker` | Used by Factory daemon for heartbeats, Cell relay (`claims`, `heartbeats`, `transitions`, `resolve`, `gone`) |
| `web_join` | `sf_join_` | HQ on start (`$HQ_DATA_DIR/web-demo.join`, `0600`) | Single-use | none | Exchanged once on loopback `POST /api/v1/tokens/join` for `web_session` ([web.md](./web.md)) |
| `web_session` | `sf_sup_` | HQ on web join or rotate | 24h rotatable | `supervisor:read`, `supervisor:write` | Web UI BFF calls to HQ (no `admin:tokens`) |

Cells have no HQ token; Factory relays Cell requests with `factory_session` + `x-cell-id` header.

## 4. Agent Reporting (Operator & Mechanic via Cell)

Agents inside a Job call local Cell loopback ([operator.md](./operator.md)). Cell validates local files/git state and translates verbs into HQ calls (`packages/hq-contracts/src/`):

| Role | Verb | Cell Local Action | HQ Endpoint Call |
| :--- | :--- | :--- | :--- |
| Operator | `done` | Check `requiredFiles` in `.cell/<step-id>/`; commit checkpoint on build | `POST /jobs/{id}/transitions` (`action: 'complete'`, `epoch`, `producedFiles`, `commitSha`) |
| Operator | `verdict pass` | Same as `done` | `POST /jobs/{id}/transitions` (`action: 'complete'`, `output: { verdict: 'pass' }`) |
| Operator | `verdict fail --feedback <file>` | Copy feedback to `.cell/<step-id>/feedback.md` | `POST /jobs/{id}/transitions` (`action: 'fail'`, `detail`, `output: { verdict: 'fail', feedbackFile }`) |
| Operator | `block --reason <why> --handover <file>` | Write `.cell/<step-id>/handover.md` | `POST /jobs/{id}/transitions` (`action: 'block'`, `detail`, `handoverFile`) |
| Operator | `context` | Print Job inputs/outputs locally | none |
| Mechanic | `read` | Print incident, step states, `.cell/` logs locally | none |
| Mechanic | `incident --action ... --report <file>` | Attach report, map `--step` to `stepIndex` | `POST /incidents/{id}/resolve` (`action`, `stepIndex`, `epoch`, `diagnosis`, `outcome`, `report`) |

### Idempotency & Error Mapping

- **State-based idempotency**: HQ stores no command IDs. Transition applies if Job is live (`claimed`/`running`), owned by `x-cell-id`, and matches `epoch`. If Job already reflects outcome at same `epoch`, HQ returns `200 { already_applied: true }`.
- **Error mapping to Cell reply `code`**:
  - `StaleLeaseEpoch` (`409`) -> `stale_epoch`
  - `Conflict` / `Forbidden` (`409` / `403`) -> `rejected`
  - `UnprocessableEntity` (`422`) -> `precondition`
  - `NotFound` (`404`) -> `not_live`
  - `BadRequest` (`400`) -> `invalid`
  - `500` -> `internal`
