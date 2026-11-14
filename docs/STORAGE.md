# Storage

`packages/factory-db` implements storage. Only a `factory-runtime` composition opens the database; the
CLI and Cells use runtime clients and never access storage directly.

## 1. Engine

**SQLite** (`bun:sqlite`, WAL mode) behind Drizzle, with **one writer per database**.

Single-writer rule:

- `factory-db` provides the mechanism: `acquireWriter(dataDir)` takes an exclusive `flock` on
  `factory.lock` in the data directory. It fails immediately if another process holds it and is
  released when the holder exits or crashes. Writes through the store require a held writer.
- `factory-runtime` provides the policy: `factory run` acquires the writer for its whole lifetime; a
  one-shot CLI write acquires it for that command only; reads never need it. Behaviour while the
  writer is held is OPEN-QUESTIONS Q19.
- The in-process write mutex (§3.1) serialises writes inside the holder. The file lock is what keeps
  a second process from writing at all.
- The server (`factory-server`) is the only process that writes; the CLI and Cells reach it over the socket.

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

## 3. The append transaction

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

- The SQLite adapter holds **one in-process write mutex** for the whole of `append` and
  `transaction`. No other statement runs on the connection while a write transaction is open.
- Inside `transaction(fn)`, `fn` MUST await nothing but `tx` methods. Rendering a prompt, reading a
  blob or any other work is done before the transaction or through `tx`.

The contract suite tests this with two concurrent appenders and a slow `fn` (ROADMAP
`factory-m3-tx-spike`).

## 4. Schema

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

CREATE TABLE intake (
  project_id    TEXT NOT NULL,
  todo_id       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  seen_commit   TEXT NOT NULL,
  diagnostic    TEXT,                                   -- e.g. unparseable frontmatter, reused id
  PRIMARY KEY (project_id, todo_id)
);
```

**Dependencies are an overlay, not a column.** When the queue or the board is read, each row with
`next_kind = 'job'` gets `deps` from the rows of the Work orders in `depends_on` and the project's
`dep_policy` (CORE §8): `satisfied`, `waiting` (board status `waiting_deps`) or `broken`
(`deps_broken`). Nothing about another Work order is ever stored in a row, so a rebuild is exact.

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

- `orders` is the only projection in v2.0. It is updated inside the append transaction (§3).
- The fold is `toProjection` in `factory-core` (pure). `factory-db` only stores the row.
- Runtime admin operation `rebuild-projections` truncates `orders`, reads `events`
  in `global_seq` order, folds each Work order with `evolve` + `toProjection`, and writes the rows.
  It MUST produce an identical table; a test asserts this on every scenario fixture.
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
   then append `ExpireLease` as the importing runtime for each Work order that had an active job.
   Leases, tokens, Cells, signals and the idempotency table are not exported. In remote mode, create a
   supervisor token and join token, then let the Cells join again; local mode uses no such tokens.

## 8. Rebuild from git (last resort, no backup at all)

Best-effort recovery when the database is gone and no backup exists:

1. Intake recreates every Work order from `todos/*.md` at `origin/<baseBranch>`.
2. For each `factory/<todoId>` branch, the newest commit whose trailers say
   `Factory-Outcome: passed` (PROTOCOL §8.2) gives the last passed Station and the checkpoint
   commit. An open PR for the branch marks the Work order delivered.
3. The runtime appends `order_recovered { passedStations, checkpoint }`. Artifacts of passed
   Stations are not in git, so the Work order resumes from the first Station whose inputs cannot be
   recovered, on top of the checkpoint code.

What this cannot recover: Work orders whose PR was merged (their todo is gone from the base branch,
which is correct: they are finished), the "unique for all time" memory of old `TodoId`s, questions,
notes and budgets.

`order_recovered` is specified in CORE when milestone M8 starts (ROADMAP). Whether outputs should
also be committed to a side ref so recovery is complete is OPEN-QUESTIONS Q7.

## 9. Migrations

- Numbered SQL files in `packages/factory-db/migrations/` (`0001_init.sql`, ...), forward-only,
  applied by the Factory on boot inside one transaction, recorded in `schema_migrations`.
- A migration never rewrites `events`. Event changes go through `schemaVersion` + upcasters (CORE §11).
- Projections may be dropped and rebuilt by a migration.
