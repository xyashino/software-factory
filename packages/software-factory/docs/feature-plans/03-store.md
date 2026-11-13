# Feature: Store

Implemented design spec (schema, port and SQLite adapter). Persists the event log that the engine reads.

## Scope

- `StorePort` interface and an in-memory fake.
- SQLite adapter on `bun:sqlite`.
- Migrations.

## Port

```ts
interface StorePort {
  createTask(input: { taskId: string; workflow: string; todoPath: string; branch: string }): void;
  append(taskId: string, event: NewEvent): StoredEvent;   // assigns seq and at
  events(taskId: string): StoredEvent[];
  eventsSince(seq: number): StoredEvent[];                // supervisor tail
  tasks(filter?: { status?: TaskRowStatus[] }): TaskRow[];
  setTaskStatus(taskId: string, status: TaskRowStatus): void;
  runningAttempt(taskId: string, attemptId: string): AttemptLookup | undefined;  // for the in-pane CLI
}
```

`at` comes from an injected clock so tests control time.

## Schema

`migrations/0001_init.sql`:

```sql
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
  payload     TEXT NOT NULL,          -- JSON, validated with zod on read
  at          INTEGER NOT NULL
);
CREATE INDEX events_task ON events(task_id, seq);
CREATE INDEX events_attempt ON events(task_id, attempt_id);

CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
```

- `events` is the source of truth. `tasks.status` is a cache the supervisor rewrites after each `reduce`; it can always be rebuilt.
- Artifacts stay as files under `.evidences/<taskId>/<attemptId>/`. Events hold their paths, not their contents.
- No `attempts` or `messages` tables: both are projections of events.

## Connection

```ts
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA foreign_keys = ON');
```

Every `append` is a single `INSERT` in its own transaction. The supervisor and the in-pane CLI are the only writers.

Migrations run at open: apply each `migrations/NNNN_*.sql` with a version above the highest in `schema_migrations`, in one transaction per file.

## In-pane writes

`software-factory done`, `verdict`, `ask` and `tell` call `runningAttempt(taskId, attemptId)`: the attempt's latest event must be `attempt_started` or `agent_ready`, and no terminal event may exist for it. Otherwise the CLI exits 1 with "this attempt is no longer running". This lookup reads only `events`; it never loads workflows.

## Tests

- The fake and the SQLite adapter pass the same contract test suite.
- Two processes appending concurrently: no `database is locked`, no lost events (spawn a second Bun process in the test).
- Reopening an existing database applies only new migrations.
- A payload that fails zod on read raises a typed error naming the `seq`.
