-- STORAGE §4, verbatim. Eleven tables. The projection (`orders`) is rebuildable from `events` (§6).

CREATE TABLE projects (
  project_id    TEXT PRIMARY KEY,
  repo_url      TEXT NOT NULL,
  base_branch   TEXT NOT NULL DEFAULT 'main',
  max_running   INTEGER NOT NULL DEFAULT 2,
  dep_policy    TEXT NOT NULL DEFAULT 'delivered',      -- 'delivered' | 'merged'
  created_at    INTEGER NOT NULL
);

CREATE TABLE events (
  global_seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  at             INTEGER NOT NULL,
  actor          TEXT NOT NULL,                         -- JSON
  command_id     TEXT NOT NULL,
  epoch          INTEGER,
  schema_version INTEGER NOT NULL,
  type           TEXT NOT NULL,
  payload        TEXT NOT NULL,                         -- JSON, validated by zod
  UNIQUE (order_id, seq)
);
CREATE INDEX events_type ON events (type);

-- Projection of the Work order aggregate. Rebuildable from events at any time (§6).
-- Every column is a pure function of the Work order's own events (core `toProjection`).
CREATE TABLE orders (
  order_id               TEXT PRIMARY KEY,
  project_id             TEXT NOT NULL REFERENCES projects,
  todo_id                TEXT NOT NULL,
  title                  TEXT NOT NULL,
  line                   TEXT NOT NULL,
  priority               TEXT NOT NULL,
  depends_on             TEXT NOT NULL,                 -- JSON array of order ids
  last_seq               INTEGER NOT NULL,
  status                 TEXT NOT NULL,                 -- board status (CORE §4.2), before dependency overlay
  holder                 TEXT NOT NULL,                 -- 'queue' | 'cell' | 'supervisor' | 'none'
  next_kind              TEXT NOT NULL,                 -- CORE §6 Next.kind
  job_kind               TEXT,                          -- when next_kind = 'job'
  runner                 TEXT,                          -- when the next job is an Operator station
  required_capabilities  TEXT NOT NULL DEFAULT '[]',    -- JSON array, the next Station's `requires`
  station_id             TEXT,
  station_index          INTEGER,
  progressed             INTEGER NOT NULL,              -- 0/1
  resumed                INTEGER NOT NULL,              -- 0/1, a resume or reopen waits to run
  last_cell_id           TEXT,
  avoid_cells            TEXT NOT NULL DEFAULT '[]',    -- JSON [{ cellId, until }]
  andon_reason           TEXT,
  pr_url                 TEXT,
  pr_state               TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,              -- `at` of the last event
  UNIQUE (project_id, todo_id)
);
CREATE INDEX orders_queue ON orders (holder, next_kind, priority, created_at);

CREATE TABLE commands (
  command_id  TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  first_seq   INTEGER,
  last_seq    INTEGER,
  response    TEXT NOT NULL,
  at          INTEGER NOT NULL
);

CREATE TABLE cells (
  cell_id       TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL,                          -- hash of the Cell credential
  joined_with   TEXT REFERENCES join_tokens,
  joined_at     INTEGER NOT NULL,
  revoked_at    INTEGER,
  last_seen_at  INTEGER,
  info          TEXT                                    -- JSON from /hello: version, projects, runners, capabilities, slots
);

CREATE TABLE join_tokens (
  join_token_id TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER,
  revoked_at    INTEGER
);

CREATE TABLE leases (
  order_id    TEXT PRIMARY KEY,                         -- one active job per Work order (I4)
  job_id      TEXT NOT NULL UNIQUE,
  cell_id     TEXT NOT NULL REFERENCES cells,
  epoch       INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX leases_expiry ON leases (expires_at);

CREATE TABLE signals (
  signal_id   TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  acked_at    INTEGER
);

CREATE TABLE blobs (
  ref         TEXT PRIMARY KEY,                         -- sha256:<hex> of the uncompressed bytes
  size        INTEGER NOT NULL,
  encoding    TEXT NOT NULL,                            -- 'identity' | 'gzip'
  content     BLOB NOT NULL,
  media_type  TEXT NOT NULL,                            -- 'text/markdown', 'text/plain', 'application/json'
  created_at  INTEGER NOT NULL
);

CREATE TABLE supervisor_tokens (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE intake (
  project_id    TEXT NOT NULL,
  todo_id       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  seen_commit   TEXT NOT NULL,
  diagnostic    TEXT,                                   -- e.g. unparseable frontmatter, reused id
  PRIMARY KEY (project_id, todo_id)
);
