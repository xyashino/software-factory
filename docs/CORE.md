# Core: the domain of Software Factory v2

`packages/factory-core`. Everything in this document is **pure**: no I/O, no clock, no randomness,
no environment. Ids and timestamps arrive as inputs. The same inputs always give the same outputs,
on every machine. This is what makes R1 (portability) and R4 (determinism) hold.

## 1. Shape

The core revolves around one aggregate, the **Work order**, and four functions:

```ts
// Is this intent allowed, and which facts does it produce?
decide(state: WorkOrderState | undefined, cmd: OrderCommand, ctx: DecideContext): Result<OrderEvent[], DomainError>

// Apply one accepted fact.
evolve(state: WorkOrderState | undefined, ev: StoredEvent): WorkOrderState

// What must happen next for this Work order?
nextJob(state: WorkOrderState): Next

// Which Work orders may this Cell take, in which order?
selectClaimable(queue: readonly QueueEntry[], cell: CellView, limits: Limits): OrderId[]
```

Every write on the Factory follows the same loop (STORAGE §3 makes it atomic):

```text
load Traveler → fold evolve → decide(cmd) → evolve → nextJob → (raise_andon? add andon_raised)
              → project → append(events, expectedSeq, epoch, commandId, projection)
```

Module layout:

```text
factory-core/src/
├── ids.ts                 # OrderId, CycleId, JobId, CellId, BlobRef, CommitSha (branded strings)
├── result.ts              # Result<T, E>
├── line/                  # LineSnapshot type, Station lookup (no parsing, no hashing: that is definitions)
├── order/
│   ├── events.ts          # OrderEvent union + zod schemas + envelope
│   ├── upcast.ts          # stored schemaVersion N → current
│   ├── state.ts           # WorkOrderState, Phase, Holder, CycleState
│   ├── evolve.ts
│   ├── commands.ts        # OrderCommand union + zod schemas
│   ├── decide.ts
│   ├── next-job.ts
│   ├── context.ts         # resolveCycleContext
│   ├── status.ts          # holder + board status derivation
│   └── projection.ts      # toProjection(state): the `orders` row (STORAGE §4)
├── queue/
│   └── select.ts          # selectClaimable
├── cycle/                 # Cell-side pure policy (never imported by the Factory)
│   ├── watch.ts
│   └── policy.ts
├── contracts/             # zod DTOs of the HTTP APIs (PROTOCOL)
└── ports/                 # async interfaces: EventStore, BlobStore, LeaseStore, Clock, Ids
```

## 2. Identifiers

| Id                                           | Form                                                  | Issued by                                                                                           |
| :------------------------------------------- | :---------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `ProjectId`                                  | slug, e.g. `software-factory`                         | configuration                                                                                       |
| `TodoId`                                     | the todo file name without `.md`                      | the repo                                                                                            |
| `OrderId`                                    | `<projectId>:<todoId>`                                | intake (deterministic, so re-intake is idempotent)                                                  |
| `StationId`                                  | the Station's `id` in its Line                        | the Line definition                                                                                 |
| `CellId`                                     | ULID                                                  | Factory, at `join` (PROTOCOL §1)                                                                    |
| `JobId`, `CycleId`, `ResumeId`, `QuestionId` | ULID                                                  | Factory (`Ids` port), passed into `decide` via `DecideContext`                                      |
| `BlobRef`                                    | `sha256:<hex>`                                        | whoever uploads the content; the Factory verifies it. The core treats it as opaque and never hashes |
| `CommitSha`                                  | 40-hex git sha                                        | the Cell that pushed it                                                                             |
| `epoch`                                      | positive integer, per Work order, strictly increasing | Factory, on every claim                                                                             |

An `OrderId` is never used as a git ref or a directory name (it contains `:`). Branches and worktrees
are named after the `TodoId` (PROTOCOL §8–9).

A `TodoId` is unique per project for all time: a todo re-added after its Work order was delivered or
cancelled gets a diagnostic at intake, not a second Work order. To run the same work again, add a
todo under a new name, or `Reopen` the delivered Work order (§5.2).

## 3. Events (the Traveler)

The Traveler is the append-only list of a Work order's events.

### 3.1 Envelope

```ts
interface StoredEvent {
  schemaVersion: 2;
  seq: number; // per Work order, 1-based, gapless
  globalSeq: number; // Factory-wide order, for feeds and export
  orderId: OrderId;
  at: number; // Factory clock (ms); the only time the core ever sees
  actor:
    | { kind: 'factory' }
    | { kind: 'cell'; cellId: CellId }
    | { kind: 'operator'; cellId: CellId; cycleId: CycleId }
    | { kind: 'supervisor'; name: string };
  commandId: string; // idempotency key of the command that produced it
  epoch?: number; // the lease epoch the write was made under (cell and operator actors)
  event: OrderEvent;
}
```

### 3.2 Rules for every event

- **MUST NOT** contain an absolute path, hostname, pane id, tab id, PID or anything else that only
  means something on one machine. Files are `BlobRef`s; code is a `CommitSha`.
- **MUST** be validated with zod on write and on read. A stored event that fails validation is a
  hard error, never skipped.
- **MUST NOT** be updated or deleted. Corrections are new events.
- Free text (`detail`, `text`, `tail`) is capped at 4 KiB. Anything larger is a blob.

### 3.3 Catalogue

**Lifecycle**

| Event              | Payload                                                                                                                                         | Notes                                 |
| :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------ |
| `order_created`    | `projectId, todoId, spec { title, type, bodyBlob, contentHash }, priority, dependsOn: OrderId[], line { name, hash, snapshotBlob }, baseBranch` | The Line is **pinned** here (§4.4).   |
| `spec_updated`     | `spec, priority, dependsOn, line?`                                                                                                              | Only before the first job is claimed. |
| `priority_changed` | `priority`                                                                                                                                      | Any time before delivery.             |
| `cancelled`        | `reason`                                                                                                                                        | Terminal.                             |

**Scheduling**

| Event              | Payload                                                                     | Notes                                                                     |
| :----------------- | :-------------------------------------------------------------------------- | :------------------------------------------------------------------------ |
| `job_claimed`      | `jobId, kind, cellId, epoch, cycleId?`                                      | `epoch = previous + 1`. `cycleId` is pre-allocated for Station jobs.      |
| `job_lost`         | `jobId, epoch, reason: 'lease_expired' \| 'cell_left' \| 'cancelled'`       | Ends the job without a result.                                            |
| `workspace_failed` | `jobId, stage: 'fetch' \| 'sync' \| 'worktree' \| 'setup', detail, logBlob` | The Cell could not prepare the workspace; ends the job; no Cycle started. |

There is **no Work-order-level setup phase**. Preparing a workspace (fetch, worktree at the base
commit, `setup` commands) is part of every job, because the next job may run on a different Cell.
Cells cache prepared worktrees, so on the same Cell it is usually a no-op.

**Cycles**

| Event                 | Payload                                                                                                                                          | Notes                                                                                                                               |
| :-------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `cycle_started`       | `cycleId, jobId, stationId, n, cause: CycleCause, baseCommit, operator? { profile, runner, model }, promptBlob?`                                 | `promptBlob` is the exact prompt the Operator received (R5). The Factory fills it from the job; the Cell does not send it.          |
| `cycle_completed`     | `cycleId, artifacts: Record<key, BlobRef>, commit`                                                                                               | A non-verdict Operator station finished.                                                                                            |
| `verdict_recorded`    | `cycleId, pass, artifacts, feedbackBlob?, commit?`                                                                                               | A verdict Operator finished. `pass = false` requires `feedbackBlob`.                                                                |
| `inspection_finished` | `cycleId, passed, results: InspectionResult[]`                                                                                                   | `InspectionResult = { command, exitCode \| null, timedOut, durationMs, tail, logBlob }`. `tail` ≤ 2 KiB; the full log is `logBlob`. |
| `cycle_failed`        | `cycleId, reason: 'timed_out' \| 'crashed' \| 'stalled' \| 'start_failed' \| 'lost', detail, wipCommit?`                                         | Infrastructure outcome, not a judgement on the work. `wipCommit` is kept for the Supervisor only.                                   |
| `cycle_blocked`       | `cycleId, source: 'operator' \| 'runtime', reason: 'operator_reported' \| 'runner_prompt' \| 'question_timeout', detail, handoverBlob?, commit?` | Leads to an Andon. `source = 'operator'` requires `handoverBlob`. `commit` is the WIP checkpoint a resume continues from.           |
| `cycle_handed_over`   | `cycleId, handoverBlob, commit?`                                                                                                                 | The Cell is leaving and the Operator wrote a Handover. No Andon: another Cell continues (§5.3).                                     |
| `usage_recorded`      | `cycleId, model, inputTokens, outputTokens, costUsd?`                                                                                            | Accepted after the Cycle ended (§4.3 rule 1).                                                                                       |

```ts
type CycleCause =
  | { kind: 'first' }
  | { kind: 'retry'; feedbackFrom: CycleId } // a verdict or Inspection failed; consumes budget
  | { kind: 'restart'; of: CycleId } // infrastructure failure; clean base
  | { kind: 'handover'; of: CycleId } // the previous Cell left with a Handover; WIP base
  | { kind: 'resume'; of?: CycleId; resumeId: ResumeId }; // a Supervisor resumed or reopened; `of` absent when moved to another Station
```

**Conversation**

| Event                | Payload                                        | Notes                                                                                                                                  |
| :------------------- | :--------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| `question_asked`     | `cycleId, questionId, text`                    | Always addressed to the Supervisor in v2.0. At most one open question per Work order.                                                  |
| `question_answered`  | `questionId, by, text`                         | Also accepted for an abandoned question (§5.2 `Answer`).                                                                               |
| `question_abandoned` | `questionId`                                   | Appended by `decide` with **every** event that ends the asking Cycle. The Q&A still reaches the next Cycle of that Station as context. |
| `note_left`          | `cycleId, to: StationId \| 'supervisor', text` |                                                                                                                                        |
| `nudged`             | `cycleId, by, text`                            | A Supervisor typed into a live Operator's pane (PROTOCOL §7). Recorded so the history explains the Operator's behaviour (R5).          |

**Supervisor control**

| Event          | Payload                                                    | Notes                                                                                   |
| :------------- | :--------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| `andon_raised` | `reason: AndonReason, detail`                              | A **decision event**: the Factory appends it when `nextJob` returns `raise_andon` (§6). |
| `resumed`      | `resumeId, by, mode: ResumeMode, noteBlob?, grantRetries?` | Clears the Andon (§4.3 rules 7–8).                                                      |
| `reopened`     | `resumeId, by, stationId, noteBlob?`                       | Moves a delivered Work order back to a Station (§4.3 rule 9).                           |

```ts
type AndonReason =
  | 'cycle_blocked' // an Operator or the runtime reported a block
  | 'retries_exhausted' // a verdict or Inspection failed past the Station's budget
  | 'no_retry' // a verdict or Inspection failed and the Station declares no retry
  | 'restart_failed' // the restart or handover budget is spent
  | 'workspace_failed' // the workspace could not be prepared twice in a row
  | 'delivery_failed';

type ResumeMode =
  | { kind: 'retry_station' } // continue where the Andon was raised (§4.3 rule 7)
  | { kind: 'restart_from'; stationId: StationId }; // move back to an earlier Station (e.g. re-plan)
```

**Delivery**

| Event               | Payload                                        | Notes                                     |
| :------------------ | :--------------------------------------------- | :---------------------------------------- |
| `delivery_finished` | `jobId, prUrl, commit`                         | `commit` is the squashed delivery commit. |
| `delivery_failed`   | `jobId, detail`                                |                                           |
| `pr_state_changed`  | `prUrl, state: 'open' \| 'merged' \| 'closed'` | From intake polling GitHub.               |

## 4. State

### 4.1 WorkOrderState

```ts
interface WorkOrderState {
  orderId: OrderId;
  projectId: ProjectId;
  spec: Spec;
  priority: 'high' | 'medium' | 'low';
  dependsOn: OrderId[];
  line: LineSnapshot; // pinned, never re-read from disk

  phase: Phase;
  cycles: CycleState[]; // start order
  lastPassed: Record<StationId, CycleId>;
  retriesUsed: Record<StationId, number>; // lifetime, per failing Station; never reset
  retryGrants: Record<StationId, number>; // extra budget granted by `resumed`
  restartsUsed: Record<StationId, number>; // `restart` Cycles since that Station last passed
  lostRestartsUsed: Record<StationId, number>; // `lost` restarts and handovers since that Station last passed
  pendingFeedback?: { forStation: StationId; fromCycle: CycleId };
  pendingResume?: {
    resumeId: ResumeId;
    forStation: StationId;
    fromCycle?: CycleId; // absent: start fresh at that Station on the checkpoint
    noteBlob?: BlobRef;
  };
  checkpoint?: { commit: CommitSha; afterStation: StationId | null };
  notes: StationNote[];
  questions: QuestionRecord[]; // full history; at most one with status 'open'
  andon?: { reason: AndonReason; detail: string; at: number };
  activeJob?: {
    jobId: JobId;
    kind: JobKind;
    cellId: CellId;
    epoch: number;
    cycleId?: CycleId;
  };
  epoch: number; // the last issued epoch, 0 before any claim
  workspaceFailures: { cellId: CellId; jobId: JobId; at: number }[]; // consecutive; see §4.3 rule 10
  deliveryFailed?: { jobId: JobId; detail: string }; // set on delivery_failed; cleared on resumed
  delivery?: {
    prUrl: string;
    commit: CommitSha;
    state: 'open' | 'merged' | 'closed';
  };
  resumedWaiting: boolean; // a `resumed` / `reopened` has not yet led to a claimed job
}

type Phase =
  | { kind: 'stations'; index: number } // index into line.stations of the Station to run next
  | { kind: 'delivering' } // all Stations passed
  | { kind: 'delivered' } // a PR exists
  | { kind: 'cancelled'; reason: string };

interface CycleState {
  cycleId: CycleId;
  jobId: JobId;
  cellId: CellId;
  stationId: StationId;
  n: number; // per Station, 1-based
  cause: CycleCause;
  status: 'running' | 'passed' | 'failed' | 'blocked' | 'handed_over';
  outcome?:
    | 'done'
    | 'verdict_pass'
    | 'verdict_fail'
    | 'inspection_pass'
    | 'inspection_fail'
    | 'timed_out'
    | 'crashed'
    | 'stalled'
    | 'start_failed'
    | 'lost'
    | 'blocked'
    | 'handed_over';
  startedAt: number;
  endedAt?: number;
  baseCommit: CommitSha;
  commit?: CommitSha;
  artifacts: Record<string, BlobRef>;
  feedbackBlob?: BlobRef;
  inspectionResults: InspectionResult[];
  handoverBlob?: BlobRef;
  pausedMs: number; // time spent on answered questions; excluded from timeouts
  pausedSince?: number;
  usage?: Usage;
}
```

`status` follows `outcome`: `done`, `verdict_pass`, `inspection_pass` → `passed`; `verdict_fail`,
`inspection_fail` and the infrastructure reasons → `failed`.

Compared to v1, the flags `parked`, `blockedPr`, `escalation`, `operatorRan`, `operatorChecked`,
`extraRetry` and `pendingPrompts` are gone. Pane-level prompts are a Cell concern (§9). v1's on-call
operator returns later as the **Line lead**, a separate module (ROADMAP M10).

### 4.2 Derived: holder and board status

`status.ts` derives two values. They are **never stored as truth**, only copied into projections.

```ts
type Holder =
  | { kind: 'none' } // delivered or cancelled
  | { kind: 'cell'; cellId: CellId; epoch: number } // a job is active (including open questions)
  | { kind: 'supervisor'; cause: 'andon' }
  | { kind: 'queue' };

const holderOf = (s: WorkOrderState): Holder =>
  s.phase.kind === 'delivered' || s.phase.kind === 'cancelled'
    ? { kind: 'none' }
    : s.activeJob
      ? { kind: 'cell', cellId: s.activeJob.cellId, epoch: s.activeJob.epoch }
      : s.andon
        ? { kind: 'supervisor', cause: 'andon' }
        : { kind: 'queue' };
```

An open question while the Cycle runs keeps the holder `cell`: the Operator is waiting in its pane.
This is the one case where a Work order waits on a person and still holds a lease. The Cell runtime
bounds that wait (§9.2), so a question can never hold a Cell forever.

Board status: `queued`, `waiting_deps`, `deps_broken`, `running`, `waiting_answer`, `andon`,
`delivering`, `delivered`, `merged`, `cancelled`. `waiting_deps` and `deps_broken` need other Work
orders, so they are computed when the queue is read (STORAGE §4), not here.

### 4.3 Evolve rules (the non-obvious ones)

1. **Liveness guard.** An event about a Cycle applies only if that Cycle is the latest one and
   `status = 'running'`. `decide` already rejects such commands; the guard keeps replay deterministic
   for any history (property I3). Two exceptions, neither of which can change what runs next:
   `usage_recorded` sets `usage` on the named Cycle whatever its status, and `question_answered`
   updates the question record whatever the asking Cycle's status.
2. A job-ending event clears `activeJob`: any Cycle terminal event (`cycle_completed`,
   `verdict_recorded`, `inspection_finished`, `cycle_failed`, `cycle_blocked`, `cycle_handed_over`),
   `workspace_failed`, `delivery_finished`, `delivery_failed`, `job_lost`.
3. **Pass** (`cycle_completed`, `verdict_recorded{pass}`, `inspection_finished{passed}`):
   `lastPassed[station] = cycle`, `phase.index = stationIndex + 1` (or `delivering` past the last
   Station), `checkpoint = { commit, afterStation }` when the event carries a commit,
   `restartsUsed[station] = 0`, `lostRestartsUsed[station] = 0`, and `pendingFeedback` is cleared
   if it targets that Station.
4. **Judged failure** (`verdict_recorded{!pass}`, `inspection_finished{!passed}`): sets
   `pendingFeedback = { forStation: station.onFail.retry, fromCycle }` if `onFail` is declared.
5. `cycle_started` sets `phase.index` to the Station's index (a retry may move back, e.g. audit →
   build) and, by cause:
   - `retry`: increments `retriesUsed[station of feedbackFrom]`;
   - `restart`: increments `lostRestartsUsed[station]` when restarting a `lost` Cycle, else
     `restartsUsed[station]`;
   - `handover`: increments `lostRestartsUsed[station]`;
   - `resume`: clears `pendingResume`.
6. Any terminal event of the asking Cycle stops `pausedSince`. The question itself is closed by the
   `question_abandoned` that `decide` appends alongside (§5.2).
7. `resumed{retry_station}` clears `andon` and `workspaceFailures`, then acts by the Andon's reason:

   | Andon reason        | Effect                                                                                                               | What `nextJob` then returns                           |
   | :------------------ | :------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------- |
   | `cycle_blocked`     | `pendingResume` for the blocked Cycle (its Station, `fromCycle`)                                                     | a `resume` Cycle on the WIP commit, with the Handover |
   | `no_retry`          | `pendingResume` for the failed Cycle                                                                                 | a `resume` Cycle of the failed Station                |
   | `restart_failed`    | `pendingResume` for the failed or handed-over Cycle; `restartsUsed` and `lostRestartsUsed` of its Station reset to 0 | a `resume` Cycle with a fresh restart budget          |
   | `retries_exhausted` | `retryGrants[failing Station] += grantRetries` (`decide` defaults it to 1 and rejects 0)                             | the ordinary `retry` of `onFail.retry` (§6 row 9)     |
   | `workspace_failed`  | nothing more                                                                                                         | whatever job was pending                              |
   | `delivery_failed`   | clears `deliveryFailed`                                                                                              | `deliver`                                             |

   For every other reason `grantRetries` is added to `retryGrants` of the Andon's Station as well.

8. `resumed{restart_from: s}` clears `andon`, `workspaceFailures`, `deliveryFailed` and
   `pendingFeedback`; sets `phase.index = index(s)`; deletes `lastPassed` for every Station at or
   after `s`; resets `checkpoint` to the latest checkpoint from a Station strictly before `s` (or
   `undefined`); keeps `retriesUsed` (lifetime); and sets `pendingResume = { forStation: s }`
   **without** `fromCycle`. Artifacts of earlier Stations stay. Because `pendingResume` is answered
   before `nextJob` looks at the latest Cycle (§6 row 5), the old blocked or failed Cycle cannot
   raise the Andon again.
9. `reopened{s}` applies to a `delivered` Work order: `phase = stations` at `index(s)`; deletes
   `lastPassed` for every Station at or after `s`; sets `checkpoint = { commit: delivery.commit,
afterStation: <the Station before s, or null> }`; sets `pendingResume = { forStation: s }`. The
   rework builds **on top of the delivered commit** (the pre-squash checkpoints no longer exist on
   the remote, PROTOCOL §8). `delivery` is kept; the next delivery updates the same PR or opens a
   new one.
10. `job_claimed` sets `activeJob` and `epoch` and clears `resumedWaiting`. `resumed` and `reopened`
    set `resumedWaiting`. `workspace_failed` appends `{ cellId, jobId, at }` to `workspaceFailures`;
    `cycle_started`, `delivery_finished`, `delivery_failed`, `resumed` and `reopened` clear it.
    `delivery_failed` sets `deliveryFailed`. `delivery_finished` sets `delivery` and
    `phase = delivered`.

### 4.4 Pinned Line

`order_created.line.snapshotBlob` holds the parsed, normalised Line (JSON); `line.hash` is its hash,
computed by `factory-definitions`. `evolve` and `nextJob` read **only** the snapshot. Changing a
YAML file affects new Work orders only. Moving a Work order to a newer Line is out of scope for v2.0
(OPEN-QUESTIONS Q6).

## 5. Commands and `decide`

### 5.1 Context

```ts
interface DecideContext {
  now: number; // Factory clock
  ids: { next(): string }; // ULIDs, injected so tests are deterministic
  actor: StoredEvent['actor'];
  epoch?: number; // the epoch the caller claims to hold
  blobs: { exists(ref: BlobRef): boolean; size(ref: BlobRef): number }; // pre-fetched by the Factory
}
```

`decide` is pure: the Factory resolves everything it needs (blob existence, dependency states)
before calling it.

### 5.2 Command table

| Command                 | Actor                        | Preconditions (else error)                                                                                   | Emits                                                                    |
| :---------------------- | :--------------------------- | :----------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- |
| `CreateOrder`           | factory (intake)             | Work order does not exist                                                                                    | `order_created`                                                          |
| `UpdateSpec`            | factory (intake)             | no job ever claimed; not terminal                                                                            | `spec_updated`                                                           |
| `Cancel`                | supervisor, factory (intake) | not delivered                                                                                                | `cancelled` (+ `job_lost{cancelled}` and `cycle_failed{lost}` if active) |
| `Reprioritise`          | supervisor                   | not terminal                                                                                                 | `priority_changed`                                                       |
| `ClaimJob`              | factory (claim endpoint)     | holder `queue`; `nextJob` is `job`                                                                           | `job_claimed{epoch+1}`                                                   |
| `StartCycle`            | cell                         | `epoch == activeJob.epoch`; job is a Station job; its Cycle not started                                      | `cycle_started`                                                          |
| `ReportWorkspaceFailed` | cell                         | epoch matches; Cycle not started                                                                             | `workspace_failed`                                                       |
| `CompleteCycle`         | operator                     | epoch matches; Cycle live; not a verdict Operator; every declared artifact present, existing and non-empty   | `cycle_completed`                                                        |
| `SubmitVerdict`         | operator                     | epoch matches; Cycle live; a verdict Operator; `!pass ⇒ feedbackBlob`                                        | `verdict_recorded`                                                       |
| `ReportInspection`      | cell                         | epoch matches; Cycle live; Station is an Inspection                                                          | `inspection_finished`                                                    |
| `FailCycle`             | cell                         | epoch matches; Cycle live                                                                                    | `cycle_failed`                                                           |
| `BlockCycle`            | operator, cell               | epoch matches; Cycle live; `source=operator ⇒ handoverBlob`                                                  | `cycle_blocked`                                                          |
| `HandOverCycle`         | cell                         | epoch matches; Cycle live; `handoverBlob` exists                                                             | `cycle_handed_over`                                                      |
| `AskQuestion`           | operator                     | epoch matches; Cycle live; no open question                                                                  | `question_asked`                                                         |
| `Answer`                | supervisor                   | the question is open, or abandoned and not yet answered; ids match                                           | `question_answered`                                                      |
| `LeaveNote`             | operator                     | epoch matches; Cycle live; `to` is a later Station or `supervisor`                                           | `note_left`                                                              |
| `Nudge`                 | supervisor                   | a Cycle is running                                                                                           | `nudged`                                                                 |
| `RecordUsage`           | cell                         | the caller is the Cell that ran the named Cycle (no epoch: usage arrives late)                               | `usage_recorded`                                                         |
| `ExpireLease`           | factory (reaper)             | `activeJob` with that epoch; lease expired (checked by caller)                                               | `cycle_failed{lost}` if a Cycle runs, + `job_lost{lease_expired}`        |
| `ReleaseJob`            | cell (leaving)               | epoch matches                                                                                                | as `ExpireLease` with `cell_left`                                        |
| `Resume`                | supervisor                   | `andon` set; mode valid for the Line; `retries_exhausted` + `retry_station` ⇒ `grantRetries ≥ 1` (default 1) | `resumed`                                                                |
| `Reopen`                | supervisor                   | phase `delivered`; PR not `merged`; Station exists in the Line                                               | `reopened`                                                               |
| `ReportDelivery`        | cell                         | epoch matches; job kind `deliver`                                                                            | `delivery_finished` / `delivery_failed`                                  |
| `RecordPrState`         | factory (intake)             | `delivery` set                                                                                               | `pr_state_changed`                                                       |

**One rule for all of them:** when the events a command emits end a Cycle that has an open question,
`decide` appends `question_abandoned` for it. This covers `CompleteCycle`, `SubmitVerdict`,
`FailCycle`, `BlockCycle`, `HandOverCycle`, `ExpireLease`, `ReleaseJob` and `Cancel` alike.

A command may be sent with `dryRun` (PROTOCOL §3.2): the Factory runs `decide` and returns the
result or the error without appending anything.

```ts
type DomainError =
  | { code: 'not_found' }
  | { code: 'stale_epoch'; current: number } // the caller lost its lease: stop working on this Work order
  | { code: 'not_live'; cycleId: CycleId } // the Cycle already ended
  | { code: 'precondition'; detail: string } // e.g. no open question, Andon raised
  | { code: 'invalid'; issues: string[] }; // e.g. missing artifact, empty blob
```

Idempotency is **not** handled here: the store returns the events originally produced for a known
`commandId` (STORAGE §3). `decide` sees each command once.

### 5.3 The ways a Station runs again

|              | Trigger                                                                            | Base commit                                                                                 | Context added                                           | Budget                                                                                                                                                                                        |
| :----------- | :--------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **retry**    | a verdict or Inspection failed                                                     | the latest checkpoint (the work being fixed)                                                | the failure feedback                                    | `retriesUsed` vs `onFail.max + retryGrants`                                                                                                                                                   |
| **restart**  | infrastructure failure (`timed_out`, `crashed`, `stalled`, `start_failed`, `lost`) | the failed Cycle's `baseCommit` (clean)                                                     | "a previous Cycle was interrupted" + its Q&A            | `restartsUsed` vs `maxRestarts` (default 1); a `lost` Cycle counts against `lostRestartsUsed` vs `maxLostRestarts` (default 3) instead, because a Cell that vanished is not the Cycle's fault |
| **handover** | the Cell left and the Operator wrote a Handover                                    | the handed-over Cycle's `commit` (WIP) if any, else its base                                | the Handover + its Q&A                                  | `lostRestartsUsed` vs `maxLostRestarts`                                                                                                                                                       |
| **resume**   | a Supervisor resumed an Andon or reopened a delivery                               | the named Cycle's `commit` (WIP) if any, else its base; with no named Cycle, the checkpoint | the Handover (if any) + the Supervisor's note + its Q&A | unlimited (a person decided)                                                                                                                                                                  |

Whatever the cause, a Cycle of a Station that `pendingFeedback` targets also receives that feedback
(§7): a retry that was restarted or handed over must still know what it is fixing.

## 6. `nextJob`

```ts
type Next =
  | { kind: 'done' }
  | { kind: 'busy' } // a job is active
  | { kind: 'await_supervisor'; cause: 'andon' }
  | { kind: 'raise_andon'; reason: AndonReason; detail: string } // the Factory appends andon_raised
  | { kind: 'job'; job: JobSpec };

type JobSpec =
  | {
      kind: 'run_operator_station';
      stationId: StationId;
      n: number;
      cause: CycleCause;
      base: CommitSha | 'branch_base';
    }
  | {
      kind: 'run_inspection';
      stationId: StationId;
      n: number;
      cause: CycleCause;
      base: CommitSha | 'branch_base';
    }
  | { kind: 'deliver'; base: CommitSha };
```

Decision table, top to bottom, first match wins. "Latest Cycle" is the last entry of `cycles`.

| #   | Condition                                                                                      | Result                                                                                                                                                |
| :-- | :--------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | phase `delivered` or `cancelled`                                                               | `done`                                                                                                                                                |
| 2   | `activeJob` set                                                                                | `busy`                                                                                                                                                |
| 3   | `andon` set                                                                                    | `await_supervisor`                                                                                                                                    |
| 4   | `workspaceFailures` has ≥ 2 entries                                                            | `raise_andon workspace_failed`                                                                                                                        |
| 5   | `pendingResume` set                                                                            | `job` of that Station, cause `resume`; base = `fromCycle`'s `commit ?? baseCommit`, or the checkpoint (else `branch_base`) when `fromCycle` is absent |
| 6   | latest Cycle `blocked`                                                                         | `raise_andon cycle_blocked`                                                                                                                           |
| 7   | latest Cycle `handed_over`, `lostRestartsUsed` under budget                                    | `job` of the same Station, cause `handover`, base = its `commit ?? baseCommit`                                                                        |
| 8   | same, budget spent                                                                             | `raise_andon restart_failed`                                                                                                                          |
| 9   | latest Cycle failed with `verdict_fail` / `inspection_fail`, Station has `onFail`, budget left | `job` of `onFail.retry`, cause `retry`, base = checkpoint                                                                                             |
| 10  | same, no `onFail`                                                                              | `raise_andon no_retry`                                                                                                                                |
| 11  | same, budget spent                                                                             | `raise_andon retries_exhausted`                                                                                                                       |
| 12  | latest Cycle failed with an infrastructure reason, its budget left (§5.3)                      | `job` of the same Station, cause `restart`, base = its `baseCommit`                                                                                   |
| 13  | same, budget spent                                                                             | `raise_andon restart_failed`                                                                                                                          |
| 14  | `deliveryFailed` set                                                                           | `raise_andon delivery_failed`                                                                                                                         |
| 15  | phase `stations`                                                                               | `job` of `stations[index]` (`run_operator_station` or `run_inspection`), cause `first`, base = checkpoint or `branch_base`                            |
| 16  | phase `delivering`                                                                             | `job deliver`, base = checkpoint                                                                                                                      |

Notes on the order:

- Row 4 sits above every job row, so a workspace that cannot be prepared raises the Andon whatever
  job was pending (first run, retry, restart, handover or resume). It needs no knowledge of the
  fleet: preferring a different Cell for the second try is the queue's job (`avoidCells`, §8).
- Row 5 sits above rows 6–13, so a `resumed` or `reopened` is always answered before the outcome of
  the old Cycle is looked at again.
- Row 16 is idempotent by contract: a delivery job first looks for an existing PR for the branch.

## 7. Cycle context

`resolveCycleContext(state, stationId, cause)` returns what goes into the prompt. The Factory renders
it into text with the Operator profile and templates, stores the result as a blob, and puts that
blob into the job.

```ts
interface CycleContext {
  inputs: Array<
    | {
        kind: 'artifact';
        stationId;
        key;
        cycleId;
        blob: BlobRef;
        materialiseAs: string;
      } // relative path, e.g. `.cell/inputs/plan.plan.md`
    | { kind: 'inspection'; stationId; cycleId; commands: string[] }
    | { kind: 'order'; field: 'title' | 'body' | 'branch'; value: string }
  >;
  notes: { fromStation: StationId; text: string }[];
  feedback?:
    // present whenever pendingFeedback targets this Station, whatever the cause
    | { kind: 'verdict'; fromCycle; blob: BlobRef }
    | {
        kind: 'inspection';
        fromCycle;
        results: InspectionResult[];
        logBlobs: BlobRef[];
      };
  resume?: { fromCycle?; handoverBlob?: BlobRef; noteBlob?: BlobRef };
  handover?: { fromCycle; handoverBlob: BlobRef };
  restart?: { of: CycleId; reason: string };
  nudges: string[]; // none at start; listed for completeness of the audit view
  priorQuestions: { question: string; answer?: string }[]; // from earlier Cycles of this Station
  outputs: { key: string; path: string }[]; // relative paths the Operator must write
}
```

Paths in the context are **relative to the worktree**. The Cell writes input blobs to those paths
before the Operator starts. No absolute path is ever rendered into a stored prompt.

Inspection feedback in a prompt is rendered by the Factory from `logBlobs`: ANSI stripped, the last
12,000 characters of each log (v1 logic). The event itself only carries the 2 KiB `tail`.

## 8. Queue selection

```ts
interface QueueEntry {
  // one row of the queue projection (STORAGE §4)
  orderId;
  projectId;
  priority;
  createdAt;
  holder: Holder['kind'];
  next: Next['kind'];
  jobKind?: JobSpec['kind'];
  runner?: string; // for Operator stations
  requiredCapabilities: string[]; // the Station's `requires` tags (e.g. 'docker', 'gpu')
  dependsOn: OrderId[];
  deps: 'satisfied' | 'waiting' | 'broken'; // computed when the queue is read, from the other Work orders
  progressed: boolean; // at least one Station passed
  resumed: boolean; // WorkOrderState.resumedWaiting
  lastCellId?: CellId;
  avoidCells: { cellId: CellId; until: number }[]; // cooldown after a workspace failure (never permanent)
}

interface CellView {
  cellId;
  projects: ProjectId[];
  runners: string[];
  capabilities: string[];
  freeSlots: number;
}
interface Limits {
  now: number;
  perProjectRunning: Record<ProjectId, { max: number; running: number }>;
}
```

A Work order is claimable by a Cell iff: `holder = queue`, `next = job`, `deps = satisfied`, the Cell
serves the project, the Cell has the Station's runner and all `requiredCapabilities`, the Cell is
not in an active `avoidCells` cooldown (`until > limits.now`), and the project is under its
concurrency limit.

`avoidCells` is derived by `toProjection` from `workspaceFailures`: `until = at +
WORKSPACE_COOLDOWN_MS` (a core constant, 10 min), so rebuilding the projection gives the same value.

Order, first key wins:

1. priority (`high` > `medium` > `low`);
2. `resumed` first (a Supervisor is waiting for the result);
3. `progressed` first (finish what was started before starting new work);
4. same Cell as `lastCellId` first (warm worktree);
5. `createdAt` ascending, then `orderId` (total order, deterministic).

Dependency policy:

- A dependency is **satisfied** when its Work order is `delivered` (PR opened). A project can require
  `merged` instead (OPEN-QUESTIONS Q4).
- A dependency that names no Work order and no todo file is satisfied (v1 parity,
  `decisions/20261113-083516-software-factory-clarify-missing-dependency-rule.md`).
- A dependency is **broken** when its Work order is `cancelled`, or when the project requires
  `merged` and its PR was closed unmerged. The dependent shows as `deps_broken` on the board and is
  never claimed; it never silently counts as satisfied. The Supervisor fixes the todo or cancels.
- A dependency that is reopened after its dependent already started does not stop the dependent.

## 9. Cycle runtime (Cell side)

`core/cycle/` is pure, but **only the Cell imports it** (lint rule, STRUCTURE §4). It is v1's
`watch.ts` moved out of the Work order domain.

### 9.1 Watch

```ts
interface Observation { operator: 'working' | 'idle' | 'blocked' | 'gone' | 'unknown'; lastOutputAt: number }
interface RuntimeCycle { startedAt: number; pausedMs: number; pausedSince?: number; reminders: { idle: number; silent: number } }

watch(cycle: RuntimeCycle, obs: Observation, now: number, policy: WatchPolicy):
  | { type: 'none' }
  | { type: 'remind'; kind: 'idle' | 'silent' }
  | { type: 'fail'; reason: 'timed_out' | 'crashed' | 'stalled' }   // → FailCycle
  | { type: 'block'; reason: 'runner_prompt' }                       // → BlockCycle{source: runtime}
```

Order: timeout, gone, (paused → none), blocked prompt, idle, silence. Same as v1.

### 9.2 Question hold

While a question is open the Operator waits in its pane and the Cell keeps its slot. After
`questionHoldMs` (default 30 min) the Cell types the `handoverRequest` prompt ("write your Handover
and run `factory-operator block`"); if the Operator does not comply within 5 min the Cell reports
`BlockCycle{source: runtime, reason: question_timeout}`.

The question is then abandoned, but the Supervisor can still answer it (`Answer` accepts an
abandoned, unanswered question). The answer reaches the resumed Cycle through `priorQuestions`.

### 9.3 Runtime journal

Pane ready, reminders and typed answers are recorded in a **Cell-local** journal
(`<cell data dir>/runtime/<cycleId>.jsonl`, PROTOCOL §9) for debugging. They are never Work order
events. A Cell may ship the journal to the Factory as a blob at the end of the Cycle.

## 10. Invariants

Each one is a property test (fast-check) over random command sequences, plus named scenarios.

| ID  | Invariant                                                                                                                                                                                                                                                                                         |
| :-- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | **Determinism.** Folding the same events gives the same state; `nextJob` of that state is the same, on any machine.                                                                                                                                                                               |
| I2  | **Machine independence.** No stored event matches an absolute-path, hostname or pane-id pattern (schema test).                                                                                                                                                                                    |
| I3  | **Late facts are inert.** Inserting an event about a non-live Cycle anywhere in a history does not change `nextJob`, and changes the state at most in that Cycle's `usage` or a question's answer.                                                                                                |
| I4  | **Single writer.** For every Work order, at most one `activeJob`; every accepted cell/operator event except `usage_recorded` carries the epoch of the job active when it was appended.                                                                                                            |
| I5  | **Monotone epochs.** `job_claimed.epoch` strictly increases per Work order.                                                                                                                                                                                                                       |
| I6  | **Progress is kept.** `cycle_blocked`, `cycle_handed_over`, `andon_raised`, `resumed{retry_station}`, `job_lost` never remove an entry from `lastPassed` and never decrease `phase.index`. Only `resumed{restart_from}` and `reopened` may, and only for Stations at or after their target.       |
| I7  | **Andons hold no Cell.** `holder = supervisor ⇒ activeJob = undefined`.                                                                                                                                                                                                                           |
| I8  | **Bounded retries.** For every Station, `retriesUsed ≤ onFail.max + retryGrants`.                                                                                                                                                                                                                 |
| I9  | **No silent stop.** For every non-terminal state, `nextJob ≠ done`; `raise_andon` is followed by `await_supervisor` once its `andon_raised` is applied; and after any `resumed` or `reopened`, `nextJob` is `job` (a resume never re-raises the Andon it cleared without a new event in between). |
| I10 | **Idempotent commands.** Replaying any command with the same `commandId` produces no new events. (Store-level contract test.)                                                                                                                                                                     |
| I11 | **Bounded machine loss.** Without a Supervisor command, no Station sees more than `maxRestarts + maxLostRestarts + 2` consecutive Cycles or workspace failures without a pass or an Andon.                                                                                                        |

## 11. Versioning

- Every stored event carries `schemaVersion`. The core reads only the current version; older
  versions go through `upcast.ts` on read. Stored rows are never rewritten.
- The Line snapshot carries its own `snapshotVersion` with its own upcaster.
- Adding an optional field is not a version bump. Renaming, removing or changing meaning is.

## 12. Testing

| Level    | What                                                                                                                            | Tool                               |
| :------- | :------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------- |
| Unit     | `evolve` per event, `decide` per command and per error, `nextJob` per table row, `select` ordering                              | vitest                             |
| Scenario | `given(events).when(command).then(events)` and `given(events).nextJob(expected)`; every v1 scenario rewritten here (ROADMAP M1) | vitest + harness in `core/testing` |
| Property | I1–I9, I11 over generated command sequences against a generated Line                                                            | fast-check                         |
| Contract | One suite run against the fake and the SQLite `EventStore` (I10, concurrency)                                                   | vitest                             |
