# Rules (v2)

Hard rules for every change to v2, by people or Operators. A change that breaks one is rejected in
review. Changing a rule needs a `decisions/` entry and an edit to this file in the same PR.
Repo-wide rules in `.nitpick/config.ts` still apply.

## 1. Core

1. `factory-core` **MUST** be pure: no I/O, no `Date.now()`, no `Math.random()`, no environment reads,
   no logging, no hashing, no `bun:*` / `node:*` imports. Time and ids are inputs.
2. Every Work order decision **MUST** come from `decide` / `nextJob` over the pinned Line and the
   Work order's Traveler. No LLM call decides a transition, retry or Andon.
3. Every branch of `evolve`, `decide`, `nextJob`, `toProjection` and `selectClaimable` **MUST** have a
   test driven by events and commands alone.
4. The invariants of CORE §10 **MUST** be property-tested and **MUST** stay green.

## 2. Events and storage

1. Events are append-only. Code **MUST NOT** update or delete an event row.
2. An event **MUST NOT** contain an absolute path, hostname, pane id, process id or any other
   machine-local value.
3. Event payloads **MUST** be validated with zod on write and on read.
4. A change to an event's meaning **MUST** bump `schemaVersion` and add an upcaster. Stored events
   are never migrated in place.
5. Projections **MUST** be updated in the same transaction as the events they derive from, and
   **MUST** be rebuildable from events with an identical result.
6. No component other than a `factory-runtime` composition **MAY** open the database. CLI and Worker
   code **MUST NOT** access storage directly. Local clients **MUST** go through the Unix socket to the
   running `factory-server`, or use the one-shot in-process fallback under the writer lock (STORAGE §1).
   A Worker **MUST NOT** open a database connection of its own.

## 3. Distribution

1. Every command **MUST** carry a `commandId`; every handler **MUST** be idempotent on it.
2. Every Worker or Operator write **MUST** carry the lease epoch and **MUST** be rejected when stale.
   The single exception is `RecordUsage`, which cannot change what runs next (CORE §4.3 rule 1).
3. A Worker **MUST NOT** push to a Work order branch before the runtime has confirmed its epoch with a
   dry run, and every push **MUST** use `--force-with-lease` against the tip it just fetched
   (PROTOCOL §8.2).
4. A Worker **MUST** self-fence when it cannot heartbeat for the self-fence window.
5. A Work order with an Andon raised **MUST NOT** hold a lease. The only wait on a person that may
   hold one is an open question, bounded by the question hold (CORE §9.2).
6. Workers **MUST NOT** open inbound network ports. The server **MAY** bind a Unix socket locally
   (`factory.sock`, mode 0600); in distributed mode it **MAY** bind TCP. The Factory server **MUST NOT**
   call Workers; Workers initiate requests.
7. Every wait **MUST** be bounded: network calls, git, Herdr, Inspections, Operators, question holds,
   Handovers on leave.

## 4. Boundaries

1. `factory-runtime` and `apps/server` **MUST NOT** import Herdr, runner, worktree or `core/cycle` code.
2. Workers **MUST NOT** import `factory-db` or `factory-definitions`; everything a job needs arrives
   in the `Job`, including the text of runtime prompts.
3. `factory-operator` **MUST** talk only to its Worker's socket and **MUST NOT** know the Factory
   address.
4. v2 packages **MUST NOT** import `@repo/software-factory`.
5. Runner-specific code **MUST** live only in `apps/worker/src/adapters/runners/<runner>.ts`.
6. `factory-db` **MUST NOT** call `decide`, `nextJob` or `toProjection`; it stores what it is given.
7. Local and remote `FactoryClient` adapters **MUST** implement the same transport-neutral contracts.
   Adapters **MUST NOT** duplicate domain/application decisions or bypass the runtime to access SQLite.

## 5. Prompts and definitions

1. Rendered prompts **MUST** be stored as blobs and referenced from `cycle_started`.
2. Paths in prompts **MUST** be relative to the worktree.
3. Prompt text **MUST** live in `factory-definitions` (`operators/`, `templates/`), never in
   TypeScript. This includes runtime prompts (answer, nudge, reminders, Handover request), which
   `factory-runtime` renders into the `Job`.
4. Inspection output **MUST** be ANSI-stripped and truncated to its last 12,000 characters before it
   reaches a prompt; the full log is a blob; the copy in the event is at most 2 KiB.
5. Adding an Operator profile or a Line **MUST NOT** need TypeScript. Invalid definitions **MUST** be
   rejected by `factory check` with file and field.

## 6. Testing

1. Every port **MUST** have an in-memory fake in `factory-core/testing`.
2. Every store implementation **MUST** pass the shared contract suite.
3. A bug fix **MUST** come with a test that fails before the fix.
4. Tests **MUST NOT** mock internals of the module under test; replace ports.
5. Local and remote adapter tests **MUST** run equivalent scenarios and assert equivalent events and
   projections.
6. Distributed behaviour (takeover, partition, duplicate requests, a Worker leaving) **MUST** have an
   automated test with at least two Worker processes (ROADMAP M7).
