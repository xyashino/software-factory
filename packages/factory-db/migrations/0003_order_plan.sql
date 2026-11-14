-- Order Plan (CORE §12, STORAGE §4). `orders.plan` names the plan a Work order belongs to; `base_branch`
-- is the base it was created on (CORE §12.5). Both come from `order_created`, so a rebuild fills them for
-- Work orders that existed before this migration (STORAGE §6). The `plans` table is the projection of the
-- Order Plan aggregate, written in the same transaction as its events.

ALTER TABLE orders ADD COLUMN plan TEXT;
ALTER TABLE orders ADD COLUMN base_branch TEXT NOT NULL DEFAULT '';
CREATE INDEX orders_plan ON orders (project_id, plan);

CREATE TABLE plans (
  plan_id          TEXT PRIMARY KEY,                    -- `<projectId>:plan:<slug>`, the stream id in `events.order_id`
  project_id       TEXT NOT NULL REFERENCES projects,
  slug             TEXT NOT NULL,
  branch           TEXT NOT NULL,                       -- 'feat/<slug>'
  base_branch      TEXT NOT NULL,
  last_seq         INTEGER NOT NULL,
  phase            TEXT NOT NULL,                       -- 'branching' | 'active' | 'pr_open' | 'ready' | 'completed' | 'cancelled'
  holder           TEXT NOT NULL,                       -- 'queue' | 'cell' | 'supervisor' | 'members' | 'none'
  next_kind        TEXT NOT NULL,                       -- CORE §12.3 PlanNext.kind
  job_kind         TEXT,                                -- 'plan_branch' | 'plan_pr' | 'plan_pr_ready', when next_kind = 'job'
  members          TEXT NOT NULL DEFAULT '[]',          -- JSON [{ orderId, todoId, after?, state }] in chain order, root first
  branch_commit    TEXT,                                -- plan_branch_created.commit
  pr_url           TEXT,
  pr_state         TEXT,                                -- 'open' | 'merged' | 'closed'
  last_cell_id     TEXT,
  avoid_cells      TEXT NOT NULL DEFAULT '[]',          -- JSON [{ cellId, until }], from the plan's failures (as `orders`)
  andon_reason     TEXT,                                -- 'plan_job_failed' | 'plan_pr_closed'
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,                    -- `at` of the last event
  UNIQUE (project_id, slug)
);
CREATE INDEX plans_queue ON plans (holder, next_kind, created_at);
