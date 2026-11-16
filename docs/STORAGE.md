# Storage

`packages/factory-db` implements storage. Only a `factory-runtime` composition opens the database; the
CLI and Cells use runtime clients and never access storage directly.

## 1. Engine

**SQLite** (`bun:sqlite`, WAL mode) behind Drizzle, with **one writer per database**.

**Drizzle-only query layer.** Every `factory-db` store queries through the Drizzle query builder on
`FactoryDatabase` (`db.ts`, `drizzleOf`), typed by `schema.ts`: a row type is `typeof table.$inferSelect`
or `$inferInsert`, never a hand-written interface. JSON columns are parsed where they are read. There is
one way to talk to the database, and the raw statements that remain are the ones Drizzle cannot express:

- connection pragmas (`openDatabase`);
- transaction control: `BEGIN IMMEDIATE`, `COMMIT`, `ROLLBACK` and savepoints (§3.1);
- the migration runner (§9), which owns the `schema_migrations` table;
- `VACUUM INTO` for backup (§7).

Each remaining raw call carries a one-line `raw:` comment. `src/__tests__/raw-sql-allowlist.test.ts`
counts the raw calls per file and fails on any change until the allowlist is updated with a reason. A
new `db.run(`, `db.query(`, `db.prepare(` or `db.exec(` outside it is a review finding.

Single-writer rule:

- `factory-db` provides the mechanism: `acquireWriter(dataDir)` takes an exclusive `flock` on
  `factory.lock` in the data directory. It fails immediately if another process holds it and is
  released when the holder exits or crashes. Writes through the store require a held writer.
- `factory-runtime` provides the policy: `factory run` acquires the writer for its whole lifetime; a
  one-shot CLI write acquires it for that command only; reads never need it. Behaviour while the
  writer is held is OPEN-QUESTIONS Q19.
- The in-process write mutex (§3.1) serialises writes inside the holder. The file lock is what keeps
  a second process from writing at all.
- The server (`factory-server`) is the only process that writes; the CLI and Cells reach it over HTTP.
- The data directory also holds `server.json`, the discovery file of the running server (PROTOCOL §2):
  its address, the local supervisor token and the local join token. It is written atomically on start
  with mode `0600` on POSIX, and removed on a clean shutdown; it is not a store, and no database row
  holds the local supervisor token. A file left by a crash names a server that no longer answers, and
  clients then take the one-shot path.

Why not Postgres from day one: each active runtime has one writer, so SQLite's single writer is not a
limit; `BEGIN IMMEDIATE` gives an atomic claim; backup is one file; there is nothing to operate. The
ports in `factory-core` are **async** and the SQL stays portable, so moving to Postgres (for an HA
control plane, OPEN-QUESTIONS Q1) is an adapter change, not a redesign.

Local mode stores `$FACTORY_DATA_DIR/factory.db`, default `~/.local/share/factory/`. A remote server
stores its own database using the same setting, defaulting to
`~/.local/share/factory-server/`. The CLI config stores mode, remote URL/credentials, and the local
database path; it is a config file, not a second SQLite database. Local and remote databases are
separate sources of truth; switching modes does not copy or synchronize queue state. Never put a
database inside a repository. The local data directory and config are user-owned and MUST NOT be
world-readable; use restrictive platform permissions for database files and credentials.

## 2. Ports

```ts
interface EventStore {
  /** All events of a Work order (its Traveler), upcast to the current schema. */
  load(orderId: OrderId): Promise<StoredEvent[]>;
  /** Factory-wide feed from a global position (stream, export, projections rebuild). */
  feed(afterGlobalSeq: number, limit: number): Promise<StoredEvent[]>;
  /**
   * Atomically: check idempotency, check expectedSeq, insert events, update projections,
   * store the command result. See §3.
   */
  append(input: AppendInput): Promise<AppendResult>;
  /** Runs `fn` inside one write transaction (claim, reaper, continuation). See §3.1. */
  transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T>;
}

interface AppendInput {
  orderId: OrderId;
  commandId: string;
  expectedSeq: number; // the last seq the caller folded
  actor: Actor;
  epoch?: number;
  events: OrderEvent[];
  projection: OrderProjection; // core `toProjection` of the post-append state, computed by the caller
  response: unknown; // what to return on an idempotent replay
}

type AppendResult =
  | { kind: 'appended'; events: StoredEvent[] }
  | { kind: 'replayed'; response: unknown } // commandId already seen
  | { kind: 'conflict'; currentSeq: number }; // someone appended first: reload and decide again

interface BlobStore {
  /** Throws when the bytes do not hash to `ref` or exceed the limit of `kind` (§5). Idempotent. */
  put(ref, bytes, mediaType?, kind?: 'text' | 'log'): Promise<void>;
  get(ref): Promise<Uint8Array | undefined>;
  /** Uncompressed size of each stored blob; missing refs are absent from the map. */
  stat(refs): Promise<Map<BlobRef, number>>;
  /** Deletes unreferenced blobs created at or before `now - 24 h`. Returns the refs deleted. */
  sweep(now, referenced: ReadonlySet<BlobRef>): Promise<BlobRef[]>;
}
interface LeaseStore {
  /* insert, extend(cellId, jobs), expired(now), list, forCell(cellId), delete(orderId) */
  /** Boot grace (PROTOCOL §5.1): every expiry becomes `now + ttl`. */
  bootGrace(now, ttl): Promise<void>;
}
```

`factory-core/testing` ships in-memory fakes of all three and a **contract suite** both the fake and
the SQLite implementation must pass (as v1's `store.contract.ts`). Size limits, the log truncation
and the ref scan live in `factory-core/blob-rules`; gzip, hashing and the sweep query live in
`factory-db`.

The store never computes a projection and never calls `decide` or `nextJob`: the row it writes is
handed to it. This keeps domain decisions out of `factory-db` (STRUCTURE §2).

Each port is implemented with the Drizzle builder over the tables in `schema.ts` (§1). The port
contracts in `factory-core` do not change with the query layer: a store maps its table rows to the port
records and keeps the signatures it had before.

## 3. The append transaction

The block shows the steps in SQL notation. Each statement is a Drizzle builder call on the connection
(§1); only `BEGIN IMMEDIATE`, `COMMIT` and `ROLLBACK` are raw (§3.1).

```sql
BEGIN IMMEDIATE;
  -- 1. idempotency
  SELECT response FROM commands WHERE command_id = :commandId;   -- found → ROLLBACK, return 'replayed'
  -- 2. optimistic concurrency (0 when the row does not exist yet on CreateOrder)
  SELECT last_seq FROM orders WHERE order_id = :orderId;         -- coalesce(last_seq, 0) ≠ :expectedSeq → ROLLBACK, 'conflict'
  -- 3. facts
  INSERT INTO events (order_id, seq, global_seq, at, actor, command_id, epoch, schema_version, type, payload) ...;
  -- 4. projection (same transaction: never out of sync; INSERT on CreateOrder, UPDATE otherwise)
  INSERT INTO orders (...) ... ON CONFLICT(order_id) DO UPDATE SET ...;
  -- 5. command result
  INSERT INTO commands (command_id, order_id, first_seq, last_seq, response, at) ...;
COMMIT;
```

On `conflict` the Factory reloads, re-runs `decide`, and appends again (bounded: 3 tries, then 503).
The Factory's command handlers are serialised per Work order in-process too, so conflicts are rare.

A command handled with a **continuation** (PROTOCOL §4) runs inside `transaction`: the command's
events, the `job_claimed` of the next job, its lease row and one `commands` row whose response
contains `next` are committed together or not at all.

### 3.1 Transactions on a synchronous driver

`bun:sqlite` is synchronous, while the ports are async. Two rules keep a transaction closed to
outsiders:

- The SQLite adapter holds **one in-process write mutex** for the whole of `append`, `transaction`,
  writes and the projection rebuild. No other write or write-side statement runs on the writer
  connection while a write transaction is open.
- Inside `transaction(fn)`, `fn` MUST await nothing but `tx` methods. Rendering a prompt, reading a
  blob or any other work is done before the transaction or through `tx`.
- The statements inside the transaction are Drizzle builder calls on the same connection. `BEGIN
  IMMEDIATE`, `COMMIT`, `ROLLBACK` and savepoints stay raw on the `Database`. `orm.transaction` is never
  used: it would issue a plain `BEGIN`, which does not take the write lock up front.

**Reads never queue behind the writer (perf-04).** A file database has a second, read-only connection
on the same WAL file (`openReadDatabase`). Reads run on it outside a transaction and take no mutex:
`load`, `loadPlan`, `response`, `feed`, `orders()`, `plans()`, `projects.list()` and `blobs.get/stat`.
A read therefore never waits for a write transaction or a long `blob.sweep`. The rules:

- Every read keeps its zod validation (§2.3 of `RULES.md`); only the connection differs.
- A read sees the last **committed** state. Inside an open transaction it sees the pre-transaction
  state; a read issued after a write's promise resolves sees that write, because the COMMIT ran first.
- Inside `transaction(fn)` every read runs on the writer, so `tx` and the body see their own writes.
- Projection consistency is unchanged: the command loop reads the projections before its append and
  the expected-seq check refuses a stale decision, which then reloads (§3).
- `:memory:` has no file for a second connection. Without a read connection, reads queue on the mutex
  as before. Tests use `:memory:` for that fallback only.

The contract suite tests the write rules with two concurrent appenders and a slow `fn` (ROADMAP
`factory-m3-tx-spike`), and the read rules on a file database (`read-path.test.ts`).

## 4. Schema

`packages/factory-db/src/schema.ts` is the only definition of the schema (Drizzle). The SQL below is
its reading, not a second source: never edit a table by hand. The migrations in
`packages/factory-db/drizzle/` are generated from `schema.ts` (§9).

```sql
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
  order_id       TEXT NOT NULL,                         -- the stream id: an OrderId, or a PlanId (`<projectId>:plan:<slug>`, CORE §12)
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
  plan                   TEXT,                          -- plan slug (`order_created.plan`); null outside a plan
  base_branch            TEXT NOT NULL,                 -- `order_created.baseBranch`, pinned; a plan member's real base is resolved per job, never stored
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
CREATE INDEX orders_plan ON orders (project_id, plan);

-- Projection of the Order Plan aggregate (CORE §12). Same rules as `orders`: rebuildable, written in
-- the append transaction, every column a pure function of the plan's own events (core `toProjection`).
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
  info          TEXT                                    -- JSON from /hello: version, projects, runners, capabilities (a legacy slots key is ignored on read)
);

CREATE TABLE join_tokens (
  join_token_id TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER,
  revoked_at    INTEGER,
  command_id    TEXT UNIQUE                             -- the create command; migration 0002, null before it
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

-- No `intake` table. It was dropped by migration 0001_drop_intake (passive-server-04): intake read the
-- repository's todo files, and the server reads none. Idempotency of every write is the `commands` table.
```

**`projects` is mutable configuration, not an event stream.** The registry (PROTOCOL §3.1) is written by
`add`, `set` and `remove`, each under the writer lock. A change writes no event and is in no Traveler.
Its rows are part of the export and import (§7, `projects.jsonl`), and a projection rebuild does not
touch them. `remove` refuses a project that has any `orders` or `events` row, so a project
with history is never deleted; `set` refuses a `base_branch` change while a Work order of the project is
not terminal. `repo_url` never changes in place.

**Dependencies are an overlay, not a column.** When the queue or the board is read, each row with
`next_kind = 'job'` gets `deps` from the rows of the Work orders in `depends_on` and the project's
`dep_policy` (CORE §8): `satisfied`, `waiting` (board status `waiting_deps`) or `broken`
(`deps_broken`). Nothing about another Work order is ever stored in a row, so a rebuild is exact.
For a row with a `plan`, an in-plan dependency uses the stacked outcome instead of `dep_policy`
(`delivered` with a `pr_state` that is not `closed` is satisfied; `closed` or `cancelled` is broken;
CORE §8, §12.4), and the plan's root is `waiting` while its `plans` row has `phase = 'branching'`
(CORE §12.6). That is the only place a Work order row is read together with a `plans` row.

**Plans and Work orders are separate streams.** A plan's `members` column holds the members' states
as the plan last heard them (CORE §12.3); the runtime reports changes through `RecordMemberState` in
its own transaction (CORE §12.7), so one append never writes two streams. `plans` rows are written by
the same append transaction (§3, step 4) as the plan's events, with `INSERT` on `plan_created`.
`commands.order_id` holds the stream id too.

There is no `archived` flag: the board hides terminal Work orders by `updated_at` (PROTOCOL §3.1).

## 5. Blobs

| Rule                                         | Value                                                               |
| :------------------------------------------- | :------------------------------------------------------------------ |
| Text artifacts, prompts, Handovers, feedback | ≤ 2 MiB each                                                        |
| Inspection and setup logs                    | ≤ 20 MiB, gzip; larger logs are truncated head + tail with a marker |
| Compression                                  | gzip above 4 KiB                                                    |
| Referenced by any event                      | never deleted                                                       |
| Uploaded but unreferenced after 24 h         | deleted by a daily sweep                                            |

Binary artifacts are out of scope: artifacts are text by contract (as in v1).

Logs dominate the size of the database, and referenced blobs are kept forever. This is accepted for
v2.0; moving log blobs to a directory or object store behind the same `BlobStore` port is
OPEN-QUESTIONS Q17.

## 6. Projections

- `orders` and `plans` are the projections in v2.0. Each is updated inside the append transaction (§3)
  of its own stream.
- The fold is `toProjection` in `factory-core` (pure; one for Work orders, one for plans). `factory-db`
  only stores the row.
- Runtime admin operation `rebuild-projections` truncates `orders` and `plans`, reads `events`
  in `global_seq` order, folds each Work order with `evolve` + `toProjection` and each plan with its
  own `evolve` + `toProjection` (a `PlanId` stream is told apart by the `:plan:` infix), and writes the
  rows. It MUST produce identical tables; a test asserts this on every scenario fixture. The new
  `orders.plan` and `orders.base_branch` columns come from `order_created`, so a migration adds them
  and a rebuild fills them for existing Work orders.
- Adding a projection = a migration in `factory-db` + a pure fold in `factory-core`; never a change
  to events.

## 7. Backup, export, import (R1)

Three tools, from cheapest to most portable:

1. **Continuous replication (recommended):** Litestream replicating `factory.db` to S3-compatible
   storage. A new machine restores the latest state with one command. No code needed in v2.
2. **Snapshot:** runtime admin operation `backup <file>` uses SQLite `VACUUM INTO` (consistent while
   running).
3. **Export / import:** a portable, engine-independent format, also the path to Postgres:

   ```text
   export.factory.tar
   ├── manifest.json        { format: "factory-export", version: 1, exportedAt, globalSeq, schemaVersion }
   ├── projects.jsonl
   ├── events.jsonl         # in global_seq order, envelopes as stored
   └── blobs/<sha256>       # every referenced blob
   ```

   Export: `factory admin export <file>` (available through the selected client) or
   `factory-server admin export <file>` on a remote host.

   Import: runtime admin operation `import <file>`, run against the target local or remote runtime,
   into an **empty database only**: insert projects, blobs and events unchanged, rebuild projections,
   then append `ExpireLease` as the importing runtime for each Work order **and each plan** that had an
   active job.
   Leases, tokens, Cells, signals and the idempotency table are not exported. In remote mode, create a
   supervisor token and join token, then let the Cells join again; local mode uses no such tokens.

## 8. No rebuild from git

The server is a pure store (decision 20261115-200000-factory-server-is-a-pure-store): it holds tasks and state, and it
never runs `git` or `gh` and never reads a repository's `.factory/`. A lost database therefore has no git
rebuild. The recovery paths are the ones §7 names: a Litestream replica, a snapshot from `backup`, or an
export archive from `export`, imported into an empty database (`import`).

With none of them, the Work orders are created again through the task API: each Supervisor sends
`POST /v1/orders` or `POST /v1/plans` with the pinned `LineSnapshot`, and the Cells take the repositories'
`.factory/` and todos from the repositories themselves. The history (events, questions, budgets, counters,
leases) and the artifacts of the passed Stations are not recovered. `order_recovered` (CORE §4.3 rule 11)
stays in the event vocabulary for the histories that carry it; no path appends it now.

Keep a `backup` or `export` on a schedule, so the case of a lost database with no copy does not arise.

## 9. Migrations

- **Source of truth:** `packages/factory-db/src/schema.ts`. Never hand-write SQL for a schema change.
- **Adding a migration:** edit `schema.ts`, then run `pnpm --filter @repo/factory-db db:generate`
  (add `--custom` for a change Drizzle cannot express, and comment why in that file). Commit the new
  file and the updated `drizzle/meta/` together. `db:check` (in `pnpm ci:verify`) fails when
  `schema.ts` and `drizzle/` drift apart, and runs `drizzle-kit check` on the snapshots.
- **Baseline:** `drizzle/0000_baseline.sql` is generated from `schema.ts`. A fresh database is built
  from it. It is schema-identical to migrations 0001-0003 (the test in `__tests__/schema.test.ts`).
- **Runner:** `migrate.ts` applies `drizzle/meta/_journal.json` forward only, in one
  `BEGIN IMMEDIATE` transaction (§3.1). Each file is recorded in `schema_migrations` under its tag. A
  failure rolls the whole batch back. An applied name missing from `drizzle/` is an error.
- **Legacy databases:** the hand-written `packages/factory-db/migrations/` (`0001_init.sql`,
  `0002_join_token_command_id.sql`, `0003_order_plan.sql`) is **frozen**: never edited, never extended.
  It is kept because a database created before the baseline still needs it. A database whose history
  holds 0001-0003 (or a prefix of them) runs the missing legacy files in order, then records
  `0000_baseline` as applied without running it. The data is kept. Any other unknown history is
  refused. The legacy folder is deleted only when no supported database can need it.
- A migration never rewrites `events`. Event changes go through `schemaVersion` + upcasters (CORE §11).
- Projections may be dropped and rebuilt by a migration (migration 0003 triggers a rebuild of the
  `orders` projection on a database that predates the baseline).
