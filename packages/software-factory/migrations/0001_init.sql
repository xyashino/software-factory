-- Initial schema. Applied once; never edit after release, add a 0002_* instead.

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  workflow    TEXT NOT NULL,
  todo_path   TEXT NOT NULL,
  branch      TEXT NOT NULL,
  status      TEXT NOT NULL,          -- projection of TaskState.status, for listing only
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  attempt_id  TEXT,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,          -- JSON of the whole event, validated with zod on read
  at          INTEGER NOT NULL
);
CREATE INDEX events_task ON events(task_id, seq);
CREATE INDEX events_attempt ON events(task_id, attempt_id);
