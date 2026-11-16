# Core: the domain of Software Factory v2

`packages/factory-core`. Everything in this document is **pure**: no I/O, no clock, no randomness,
no environment. Ids and timestamps arrive as inputs. The same inputs always give the same outputs,
on every machine. This is what makes R1 (portability) and R4 (determinism) hold.

## 1. Shape

The core revolves around one aggregate, the **Work order**, and four functions. A second, much
smaller aggregate, the **Order Plan** (§12), groups Work orders into a stacked chain and is driven by
the same four functions over its own state, events and commands.

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

Every write handled by `factory-runtime` follows the same loop (STORAGE §3 makes it atomic):

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
├── plan/                  # Order Plan aggregate (§12): events, state, evolve, decide, next-job, projection
├── queue/
│   └── select.ts          # selectClaimable
├── cycle/                 # Cell-side pure policy (never imported by factory-runtime)
│   ├── watch.ts
│   └── policy.ts
├── contracts/             # transport-neutral zod DTOs shared by local and HTTP adapters (PROTOCOL)
└── ports/                 # async interfaces: EventStore, BlobStore, LeaseStore, Clock, Ids
```

## 2. Identifiers

| Id                                           | Form                                                  | Issued by                                                                                           |
| :------------------------------------------- | :---------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `ProjectId`                                  | slug, e.g. `software-factory`                         | configuration                                                                                       |
| `TodoId`                                     | the todo file name without `.md`                      | the repo                                                                                            |
| `OrderId`                                    | `<projectId>:<todoId>`                                | intake (deterministic, so re-intake is idempotent)                                                  |
| `PlanSlug`                                   | `^[a-z0-9][a-z0-9-]{0,63}$`, the todo's `plan:` value | the todo author (§12.1)                                                                             |
| `PlanId`                                     | `<projectId>:plan:<slug>`                             | intake (deterministic, like `OrderId`)                                                              |
| `StationId`                                  | the Station's `id` in its Line                        | the Line definition                                                                                 |
| `CellId`                                     | ULID                                                  | factory-runtime, at remote `join` (PROTOCOL §1)                                                     |
| `JobId`, `CycleId`, `ResumeId`, `QuestionId` | ULID                                                  | factory-runtime (`Ids` port), passed into `decide` via `DecideContext`                              |
| `BlobRef`                                    | `sha256:<hex>`                                        | whoever uploads the content; the runtime verifies it. The core treats it as opaque and never hashes |
| `CommitSha`                                  | 40-hex git sha                                        | the Cell that pushed it                                                                             |
| `epoch`                                      | positive integer, per Work order, strictly increasing | factory-runtime, on every claim                                                                     |

An `OrderId` is never used as a git ref or a directory name (it contains `:`). Branches and worktrees
are named after the `TodoId` (PROTOCOL §8–9). The one branch not named after a `TodoId` is a plan
branch, `feat/<slug>` (§12).

A `TodoId` MUST NOT contain `:`. This keeps every `PlanId` apart from every `OrderId`: the two share
the stream column of the `events` table (STORAGE §4), and a stream is a Work order or a plan by the
`:plan:` infix. Intake reports a todo file whose name contains `:` as a diagnostic and creates nothing.

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
  orderId: OrderId | PlanId; // the stream id: a Work order's Traveler, or an Order Plan's (§12)
  at: number; // Factory clock (ms); the only time the core ever sees
  actor:
    | { kind: 'factory' }
    | { kind: 'cell'; cellId: CellId }
    | { kind: 'operator'; cellId: CellId; cycleId: CycleId }
    | { kind: 'mechanic'; name: string }
    | { kind: 'supervisor'; name: string };
  commandId: string; // idempotency key of the command that produced it
  epoch?: number; // the lease epoch the write was made under (cell and operator actors)
  event: OrderEvent | PlanEvent; // PlanEvent only on a PlanId stream (§12.3)
}
```

The field keeps the name `orderId` so stored envelopes and the `events.order_id` column do not
change. Every `OrderEvent` is on an `OrderId` stream and every `PlanEvent` on a `PlanId` stream.

### 3.2 Rules for every event

- **MUST NOT** contain an absolute path, hostname, pane id, tab id, PID or anything else that only
  means something on one machine. Files are `BlobRef`s; code is a `CommitSha`.
- **MUST** be validated with zod on write and on read. A stored event that fails validation is a
  hard error, never skipped.
- **MUST NOT** be updated or deleted. Corrections are new events.
- Free text (`detail`, `text`, `tail`) is capped at 4 KiB. Anything larger is a blob.

### 3.3 Catalogue

**Lifecycle**

| Event              | Payload                                                                                                                                                                             | Notes                                                                                                                                          |
| :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| `order_created`    | `projectId, todoId, spec { title, type, bodyBlob, contentHash }, priority, dependsOn: OrderId[], line { name, hash, snapshotBlob }, baseBranch, plan?: PlanSlug`                    | The Line is **pinned** here (§4.4). `plan` is set once and never changes (§12.1).                                                              |
| `spec_updated`     | `spec, priority, dependsOn, line?`                                                                                                                                                  | Only before the first job is claimed.                                                                                                          |
| `priority_changed` | `priority`                                                                                                                                                                          | Any time before delivery.                                                                                                                      |
| `cancelled`        | `reason`                                                                                                                                                                            | Terminal.                                                                                                                                      |
| `order_recovered`  | `passedStations: StationId[]` (a non-empty prefix of the pinned Line), `checkpoint { commit, afterStation }`, `delivery?: { prUrl, commit, state: 'open' \| 'merged' \| 'closed' }` | Only on a fresh Work order (§4.3 rule 11). Written by `RecoverOrder` (§5.2), from git (STORAGE §8). Added in schema version 2 (additive, §11). |

**Scheduling**

| Event              | Payload                                                                     | Notes                                                                                                 |
| :----------------- | :-------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `job_claimed`      | `jobId, kind, cellId, epoch, cycleId?`                                      | `epoch = previous + 1`. `cycleId` is pre-allocated for Station jobs.                                  |
| `job_lost`         | `jobId, epoch, reason: 'lease_expired' \| 'cell_left' \| 'cancelled'`       | Ends the job without a result.                                                                        |
| `workspace_failed` | `jobId, stage: 'fetch' \| 'sync' \| 'worktree' \| 'setup', detail, logBlob` | The Cell could not prepare the workspace; ends the job; no Cycle started.                             |
| `worktree_missing` | `jobId, detail`                                                             | The Cell's job past Station 0 found no worktree; the Work order restarts at Station 0 (§4.3 rule 13). |

There is **no Work-order-level setup phase**. Preparing a workspace (fetch, worktree at the base
commit, `setup` commands) is part of every job, because the next job may run on a different Cell.
Cells cache prepared worktrees, so on the same Cell it is usually a no-op.

**Cycles**

| Event                 | Payload                                                                                                                                          | Notes                                                                                                                                                                  |
| :-------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cycle_started`       | `cycleId, jobId, stationId, n, cause: CycleCause, baseCommit, operator? { profile, runner, model }, promptBlob?`                                 | `promptBlob` is the exact prompt the Operator received (R5). The runtime fills it from the job; the Cell does not send it.                                             |
| `cycle_completed`     | `cycleId, artifacts: Record<key, BlobRef>, commit`                                                                                               | A non-verdict Operator station finished.                                                                                                                               |
| `verdict_recorded`    | `cycleId, pass, artifacts, feedbackBlob?, commit?`                                                                                               | A verdict Operator finished. `pass = false` requires `feedbackBlob`.                                                                                                   |
| `inspection_finished` | `cycleId, passed, results: InspectionResult[]`                                                                                                   | `InspectionResult = { command, exitCode \| null, timedOut, durationMs, tail, logBlob }`. `tail` ≤ 2 KiB; the full log is `logBlob`.                                    |
| `cycle_failed`        | `cycleId, reason: 'timed_out' \| 'crashed' \| 'stalled' \| 'start_failed' \| 'lost', detail, wipCommit?`                                         | Infrastructure outcome, not a judgement on the work. `wipCommit` is kept for the Supervisor only.                                                                      |
| `cycle_blocked`       | `cycleId, source: 'operator' \| 'runtime', reason: 'operator_reported' \| 'runner_prompt' \| 'question_timeout', detail, handoverBlob?, commit?` | Leads to an Andon. `source = 'operator'` requires `handoverBlob`. `commit` is the worktree HEAD the Cycle started from (PROTOCOL §8.2), which a resume continues from. |
| `cycle_handed_over`   | `cycleId, handoverBlob, commit?`                                                                                                                 | The Cell is leaving and the Operator wrote a Handover. No Andon: another Cell continues (§5.3).                                                                        |
| `usage_recorded`      | `cycleId, model, inputTokens, outputTokens, costUsd?`                                                                                            | Accepted after the Cycle ended (§4.3 rule 1).                                                                                                                          |

```ts
type CycleCause =
  | { kind: 'first' }
  | { kind: 'retry'; feedbackFrom: CycleId } // a verdict or Inspection failed; consumes budget
  | { kind: 'restart'; of: CycleId } // infrastructure failure; clean base
  | { kind: 'handover'; of: CycleId } // the previous Cell left with a Handover; the base of its worktree
  | { kind: 'resume'; of?: CycleId; resumeId: ResumeId }; // a Supervisor resumed or reopened; `of` absent when moved to another Station
```

**Conversation**

| Event                | Payload                                        | Notes                                                                                                                                           |
| :------------------- | :--------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| `question_asked`     | `cycleId, questionId, text`                    | Addressed to the Mechanic in v2.0; it answers or escalates to the Supervisor. At most one open question per Work order.                         |
| `question_answered`  | `questionId, by, text`                         | Also accepted for an abandoned question (§5.2 `Answer`).                                                                                        |
| `question_abandoned` | `questionId`                                   | Appended by `decide` with **every** event that ends the asking Cycle. The Q&A still reaches the next Cycle of that Station as context.          |
| `note_left`          | `cycleId, to: StationId \| 'supervisor', text` |                                                                                                                                                 |
| `nudged`             | `cycleId, by, text`                            | A Supervisor or Mechanic typed into a live Operator's pane (PROTOCOL §7). Recorded with `by` so history explains the Operator's behaviour (R5). |

**Supervisor control**

| Event               | Payload                                                                       | Notes                                                                                         |
| :------------------ | :---------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| `andon_raised`      | `reason: AndonReason, detail`                                                 | A **decision event**: the runtime appends it when `nextJob` returns `raise_andon` (§6).       |
| `resumed`           | `resumeId, by, mode: ResumeMode, noteBlob?, grantRetries?`                    | Clears the Andon (§4.3 rules 7–8).                                                            |
| `reopened`          | `resumeId, by, stationId, noteBlob?`                                          | Moves a delivered Work order back to a Station (§4.3 rule 9).                                 |
| `incident_recorded` | `incidentId, by, andonAt, andonReason, diagnosis, action, changes[], outcome` | The Mechanic's record of an Andon, written before it acts on the Andon (§14.2, §4.3 rule 12). |

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

The plan events (`plan_created`, `plan_branch_created`, …) belong to the Order Plan stream and are
listed in §12.3, not here.

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
  baseBranch: string; // from `order_created`; the project's base branch at creation. A plan member's
  //                     real base is resolved per job (§12.5) and is never stored
  plan?: PlanSlug; // from `order_created`; absent for a Work order outside any plan

  phase: Phase;
  cycles: CycleState[]; // start order
  lastPassed: Record<StationId, CycleId>;
  retriesUsed: Record<StationId, number>; // lifetime, per failing Station; never reset
  retryGrants: Record<StationId, number>; // extra budget granted by `resumed`
  restartsUsed: Record<StationId, number>; // `restart` Cycles since that Station last passed
  lostRestartsUsed: Record<StationId, number>; // `lost` restarts and handovers since that Station last passed
  recovered: StationId[]; // Stations passed before a `order_recovered`; their artifacts are not held (§4.3 rule 11)
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
  incidents: IncidentRecord[]; // full history; at most one per Andon (§14.2)
  activeJob?: {
    jobId: JobId;
    kind: JobKind;
    cellId: CellId;
    epoch: number;
    cycleId?: CycleId;
  };
  epoch: number; // the last issued epoch, 0 before any claim
  workspaceFailures: {
    cellId: CellId;
    jobId: JobId;
    at: number;
    stage: WorkspaceStage;
    detail: string;
    logBlob: BlobRef;
  }[]; // consecutive; see §4.3 rule 10
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
operator is the **Mechanic**, which triages every Andon and can intervene mid-Cycle in v2.0
(decisions 20261113-230000, 20261114-112011).

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
orders, so they are computed when the queue is read (STORAGE §4), not here. For a plan member
`waiting_deps` also covers a plan branch that does not exist yet (§12.6).

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
10. **Incident** (`incident_recorded`) joins `incidents`, with `andonAt` naming the Andon it triaged.
    It changes no job and clears no Andon. Only `resumed` clears an Andon, and a Mechanic may send
    it only after the incident of that Andon exists (§5.2, §14.3).
11. `job_claimed` sets `activeJob` and `epoch` and clears `resumedWaiting`. `resumed` and `reopened`
    set `resumedWaiting`. `workspace_failed` appends `{ cellId, jobId, at }` to `workspaceFailures`;
    `cycle_started`, `delivery_finished`, `delivery_failed`, `resumed` and `reopened` clear it.
    `delivery_failed` sets `deliveryFailed`. `delivery_finished` sets `delivery` and
    `phase = delivered`.
12. **Recovery** (`order_recovered { passedStations, checkpoint, delivery? }`), a fresh Work order
    only (epoch 0, no Cycle, no job ever claimed; §5.2 `RecoverOrder`). It sets:
    - `recovered = passedStations`, `checkpoint = checkpoint`, `resumedWaiting = false`;
    - without `delivery`: `phase.index = index of the first Station after passedStations`, or
      `delivering` when every Station is in `passedStations`;
    - with `delivery` (a PR exists for `factory/<todoId>`): `delivery = { prUrl, commit, state }`
      and `phase = delivered`; `passedStations` then names every Station.

    It never writes `lastPassed`: a recovered Station has no Cycle, so `cycle_completed`-style
    lookups stay exact, and I6 holds because nothing exists yet that could be removed. A recovered
    Station's artifacts are not in the state, so `context` gives the next Station no inputs from it
    (§7); that is the recovery limit of STORAGE §8.

13. **Missing worktree** (`worktree_missing { jobId, detail }`, from `ReportWorktreeMissing`). A job past
    Station 0 (`phase` a Station with index > 0, or `delivering`) needs the worktree its earlier Stations
    left, and the Cell holding the job does not have it. The Work order restarts at Station 0: `phase =
stations/0`, `checkpoint`, `lastPassed`, `pendingFeedback`, `pendingResume`, `workspaceFailures`,
    `restartsUsed` and `lostRestartsUsed` cleared, `activeJob` cleared, `worktreeResets` incremented. The
    lifetime `retriesUsed` stays. A Station 0 job creates its own worktree, so it is never reported missing.
    `nextJob` row 4b raises the `workspace_failed` Andon once `worktreeResets` reaches `MAX_WORKTREE_RESETS`
    (2) without a delivery. `delivery_finished` and a Supervisor `resumed` or `reopened` reset the counter.

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
  blobs: { exists(ref: BlobRef): boolean; size(ref: BlobRef): number }; // pre-fetched by the runtime
}
```

`decide` is pure: the runtime resolves everything it needs (blob existence, dependency states)
before calling it.

### 5.2 Command table

| Command                 | Actor                                        | Preconditions (else error)                                                                                                                                                         | Emits                                                                    |
| :---------------------- | :------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- |
| `CreateOrder`           | factory (intake)                             | Work order does not exist                                                                                                                                                          | `order_created` (with `plan` when the todo declares one, §12.1)          |
| `UpdateSpec`            | factory (intake)                             | no job ever claimed; not terminal                                                                                                                                                  | `spec_updated`                                                           |
| `Cancel`                | supervisor, mechanic (M10), factory (intake) | not delivered                                                                                                                                                                      | `cancelled` (+ `job_lost{cancelled}` and `cycle_failed{lost}` if active) |
| `Reprioritise`          | supervisor                                   | not terminal                                                                                                                                                                       | `priority_changed`                                                       |
| `ClaimJob`              | factory (claim endpoint)                     | holder `queue`; `nextJob` is `job`                                                                                                                                                 | `job_claimed{epoch+1}`                                                   |
| `StartCycle`            | cell                                         | `epoch == activeJob.epoch`; job is a Station job; its Cycle not started                                                                                                            | `cycle_started`                                                          |
| `ReportWorkspaceFailed` | cell                                         | epoch matches; Cycle not started                                                                                                                                                   | `workspace_failed`                                                       |
| `ReportWorktreeMissing` | cell                                         | epoch matches; Cycle not started; phase past Station 0 (a Station with index > 0, or `delivering`)                                                                                 | `worktree_missing` (§4.3 rule 13)                                        |
| `CompleteCycle`         | operator                                     | epoch matches; Cycle live; not a verdict Operator; every declared artifact present, existing and non-empty                                                                         | `cycle_completed`                                                        |
| `SubmitVerdict`         | operator                                     | epoch matches; Cycle live; a verdict Operator; `!pass ⇒ feedbackBlob`                                                                                                              | `verdict_recorded`                                                       |
| `ReportInspection`      | cell                                         | epoch matches; Cycle live; Station is an Inspection                                                                                                                                | `inspection_finished`                                                    |
| `FailCycle`             | cell                                         | epoch matches; Cycle live                                                                                                                                                          | `cycle_failed`                                                           |
| `BlockCycle`            | operator, cell                               | epoch matches; Cycle live; `source=operator ⇒ handoverBlob`                                                                                                                        | `cycle_blocked`                                                          |
| `HandOverCycle`         | cell                                         | epoch matches; Cycle live; `handoverBlob` exists                                                                                                                                   | `cycle_handed_over`                                                      |
| `AskQuestion`           | operator                                     | epoch matches; Cycle live; no open question                                                                                                                                        | `question_asked`                                                         |
| `Answer`                | supervisor, mechanic (M10)                   | the question is open, or abandoned and not yet answered; ids match                                                                                                                 | `question_answered`                                                      |
| `LeaveNote`             | operator                                     | epoch matches; Cycle live; `to` is a later Station or `supervisor`                                                                                                                 | `note_left`                                                              |
| `Nudge`                 | supervisor, mechanic (M10)                   | a Cycle is running                                                                                                                                                                 | `nudged`                                                                 |
| `RecordUsage`           | cell                                         | the caller is the Cell that ran the named Cycle (no epoch: usage arrives late)                                                                                                     | `usage_recorded`                                                         |
| `ExpireLease`           | factory (reaper)                             | `activeJob` with that epoch; lease expired (checked by caller)                                                                                                                     | `cycle_failed{lost}` if a Cycle runs, + `job_lost{lease_expired}`        |
| `RecoverOrder`          | factory (`admin recover`)                    | `epoch == 0` (never claimed), no Cycle, not terminal, no `order_recovered` yet; `passedStations` is a non-empty prefix of the pinned Line, the whole Line when `delivery` is given | `order_recovered` (§4.3 rule 11)                                         |
| `ReleaseJob`            | cell (leaving)                               | epoch matches                                                                                                                                                                      | as `ExpireLease` with `cell_left`                                        |
| `Resume`                | supervisor, mechanic (M10)                   | `andon` set; mode valid for the Line; `retries_exhausted` + `retry_station` ⇒ `grantRetries ≥ 1` (default 1); mechanic: an incident of this Andon exists (§14.3)                   | `resumed`                                                                |
| `Reopen`                | supervisor                                   | phase `delivered`; PR not `merged`; Station exists in the Line                                                                                                                     | `reopened`                                                               |
| `RecordIncident`        | mechanic (M10)                               | not terminal; `andon` set and no incident for it yet; `repair` names its changes, other actions name none; every blob ref of a change exists (§14.2)                               | `incident_recorded`                                                      |
| `ReportDelivery`        | cell                                         | epoch matches; job kind `deliver`                                                                                                                                                  | `delivery_finished` / `delivery_failed`                                  |
| `RecordPrState`         | factory (intake)                             | `delivery` set                                                                                                                                                                     | `pr_state_changed`                                                       |

**One rule for all of them:** when the events a command emits end a Cycle that has an open question,
`decide` appends `question_abandoned` for it. This covers `CompleteCycle`, `SubmitVerdict`,
`FailCycle`, `BlockCycle`, `HandOverCycle`, `ExpireLease`, `ReleaseJob` and `Cancel` alike.

A command may be sent with `dryRun` (PROTOCOL §3.2): the runtime runs `decide` and returns the
result or the error without appending anything.

```ts
type DomainError =
  | { code: 'not_found' }
  | { code: 'stale_epoch'; current: number } // the caller lost its lease: stop working on this Work order
  | { code: 'not_live' } // the Cycle already ended
  | { code: 'precondition'; detail: string }
  | { code: 'invalid'; issues: string[] };
```

## 6. `nextJob`

`nextJob(state): Next` is a pure function of `WorkOrderState`.

Row 15 of a recovered Work order resumes at the first Station after `recovered`, on the checkpoint
commit (`checkpointBase`), with `cause: first`. The inputs rule of STORAGE §8 is this choice: the
Station declares no inputs in the Line, and the artifacts of recovered Stations are not in git, so
no Station can recover them; the resume point is the first Station that has not passed.

```ts
type Next =
  | { kind: 'done' } // delivered or cancelled
  | { kind: 'await_supervisor'; cause: 'andon' } // holder = supervisor; Andon already recorded
  | { kind: 'raise_andon'; reason: AndonReason; detail: string } // transient: runtime appends `andon_raised` in the same tx
  | { kind: 'wait_cell'; jobId: JobId; epoch: number } // a job is already running
  | { kind: 'escalate_andon' } // transient: the Factory records the escalation (§14.4)
  | { kind: 'job'; job: JobSpec }; // claimable; concrete JobId and epoch are assigned on ClaimJob

type JobSpec =
  | {
      kind: 'run_operator_station';
      stationId: StationId;
      n: number;
      cause: CycleCause;
      base: CommitSha | 'branch_base';
      operator: Station['operator'];
      runner: string;
      requires: string[];
    }
  | {
      kind: 'run_inspection';
      stationId: StationId;
      n: number;
      cause: CycleCause;
      base: CommitSha | 'branch_base';
      commands: string[];
      requires: string[];
    }
  | { kind: 'deliver'; base: CommitSha }
  | { kind: 'mechanic'; andonAt: number; n: number }; // no workspace (§14.4)
```

Every `JobSpec` carries `requires` so queue selection can match Cells without reading the Line again.
`run_operator_station` carries `runner` for the same reason.

Decision table (first matching row wins):

| #   | Condition                                                                                                                                                                                  | Result                                                                                                                     |
| :-- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| 1   | `phase` is `delivered` or `cancelled`                                                                                                                                                      | `done`                                                                                                                     |
| 2   | `activeJob` is set                                                                                                                                                                         | `wait_cell`                                                                                                                |
| 3   | `andon` set (§14.4): `triage` is `mechanic`, no incident yet, budget left: `job mechanic`; budget spent: `escalate_andon`; `triage` `supervisor` or an incident exists: `await_supervisor` |                                                                                                                            |
| 4   | `workspaceFailures.length ≥ 2`                                                                                                                                                             | `raise_andon workspace_failed`                                                                                             |
| 5   | `pendingResume` set                                                                                                                                                                        | `job` for `pendingResume.forStation`, cause `resume`, base = `checkpoint` or `branch_base`                                 |
| 6   | latest Cycle is `handed_over` for current Station, `lostRestartsUsed[s] < maxLostRestarts`                                                                                                 | `job` for `s`, cause `handover`, base = `latestCycle.commit` or `checkpoint` or `branch_base`                              |
| 7   | latest Cycle is `blocked` for current Station                                                                                                                                              | `raise_andon cycle_blocked`                                                                                                |
| 8   | same, budget spent                                                                                                                                                                         | `raise_andon restart_failed`                                                                                               |
| 9   | latest Cycle failed with `verdict_fail` / `inspection_fail`, Station has `onFail`, budget left                                                                                             | `job` of `onFail.retry`, cause `retry`, base = checkpoint                                                                  |
| 10  | same, no `onFail`                                                                                                                                                                          | `raise_andon no_retry`                                                                                                     |
| 11  | same, budget spent                                                                                                                                                                         | `raise_andon retries_exhausted`                                                                                            |
| 12  | latest Cycle failed with an infrastructure reason, its budget left (§5.3)                                                                                                                  | `job` of the same Station, cause `restart`, base = its `baseCommit`                                                        |
| 13  | same, budget spent                                                                                                                                                                         | `raise_andon restart_failed`                                                                                               |
| 14  | `deliveryFailed` set                                                                                                                                                                       | `raise_andon delivery_failed`                                                                                              |
| 15  | phase `stations`                                                                                                                                                                           | `job` of `stations[index]` (`run_operator_station` or `run_inspection`), cause `first`, base = checkpoint or `branch_base` |
| 16  | phase `delivering`                                                                                                                                                                         | `job deliver`, base = checkpoint                                                                                           |

Notes on the order:

- Row 4 sits above every job row, so a workspace that cannot be prepared raises the Andon whatever
  job was pending (first run, retry, restart, handover or resume). It needs no knowledge of the
  fleet: preferring a different Cell for the second try is the queue's job (`avoidCells`, §8).
- Row 5 sits above rows 6–13, so a `resumed` or `reopened` is always answered before the outcome of
  the old Cycle is looked at again.
- Row 16 is idempotent by contract: a delivery job first looks for an existing PR for the branch.
- `nextJob` never sees a plan. A plan member's base **branch** (§12.5) is resolved by the runtime
  when it builds the `Job` (PROTOCOL §4), from the member's plan and its predecessor's PR state. The
  `JobSpec` and its `base: CommitSha | 'branch_base'` are the same as for any Work order.

## 7. Cycle context

`resolveCycleContext(state, stationId, cause)` returns what goes into the prompt. The runtime renders
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

Inspection feedback in a prompt is rendered by the runtime from `logBlobs`: ANSI stripped, the last
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
  plan?: PlanSlug; // plan members only: selects the stacked outcome for in-plan dependencies
  deps: 'satisfied' | 'waiting' | 'broken'; // computed when the queue is read, from the other Work orders
  //                                           (and, for a plan root, the plan's branch, §12.6)
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
  busy: boolean; // true while the Cell holds a live lease (one Work order at a time)
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
- **Stacked dependency (plan members).** A `dependsOn` entry that is a member of the **same plan**
  does not follow the project's policy. It is **satisfied** when the predecessor is `delivered` and
  its PR is not `closed` (whether `open` or `merged`), whatever `depPolicy` says. It is **broken**
  when the predecessor is `cancelled` or its PR was closed unmerged, so the dependent shows
  `deps_broken`. Before the predecessor is delivered the dependent is `waiting`. The satisfied
  check only gates the dependent's first claim; once any job of the dependent was claimed, only
  `broken` stops it, so a predecessor reopened later (rule above) does not stop it either. A
  dependency outside the plan keeps the rules above, including `depPolicy`
  (OPEN-QUESTIONS Q22). The full plan rules are §12.4.

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

When repeated `idle` / `silent` reminders cross a stall-alert threshold before `timeoutMs`, the Cell
may upload a sanitized pane-tail blob and notify the runtime so the Mechanic (M10) can inspect the
stuck step and send a live `Nudge` (decisions 20261114-112011).

### 9.2 Question hold

While a question is open the Operator waits in its pane and the Cell keeps its job. After
`questionHoldMs` (default 30 min) the Cell types the `handoverRequest` prompt ("write your Handover
and run `factory-operator block`"); if the Operator does not comply within 5 min the Cell reports
`BlockCycle{source: runtime, reason: question_timeout}`.

The question is then abandoned, but the Supervisor can still answer it (`Answer` accepts an
abandoned, unanswered question). The answer reaches the resumed Cycle through `priorQuestions`.

### 9.3 Runtime journal

Pane ready, reminders and typed answers are recorded in a **Cell-local** journal
(`<cell data dir>/runtime/<cycleId>.jsonl`, PROTOCOL §9) for debugging. They are never Work order
events. A Cell may ship the journal to the runtime as a blob at the end of the Cycle.

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
| I12 | **No Andon cleared without an incident (Mechanic).** A `resumed` sent by the Mechanic applies only when the incident of that Andon (`andonAt`) is in `incidents`, and each Andon has at most one incident. The Supervisor path is covered once the runtime writes its system incident (§14.5).    |

## 11. Versioning

- Every stored event carries `schemaVersion`. The core reads only the current version; older
  versions go through `upcast.ts` on read. Stored rows are never rewritten.
- The Line snapshot carries its own `snapshotVersion` with its own upcaster.
- Adding an optional field is not a version bump. Renaming, removing or changing meaning is.
- Order Plans change no existing event's meaning. `order_created.plan` is a new optional field, so
  Work orders stored without it still read, and `schemaVersion` stays 2. The plan events (§12.3) are
  new types on a new kind of stream. The new Work order projection columns (`plan`, `base_branch`)
  are folded from existing events and `plan`, and are rebuilt, not migrated (STORAGE §6).

## 12. Order Plan

An **Order Plan** is a chain of Work orders `WO_1 → WO_2 → WO_3` that is built as a **stack of PRs**
on a **plan branch** `feat/<slug>`, and delivered to the project's base branch as **one** PR
`feat/<slug> → <baseBranch>` that the Factory opens itself. The guide with the end-to-end flow and
the GitHub settings it needs is [ORDER-PLAN.md](ORDER-PLAN.md).

```text
main
 └─ feat/xyz                      ← plan branch, created by the Factory from project.baseBranch
     ├─ WO_1  factory/wo-1  → PR into feat/xyz
     ├─ WO_2  factory/wo-2  → PR into factory/wo-1 (into feat/xyz once WO_1 is merged)
     └─ WO_3  factory/wo-3  → PR into factory/wo-2 (…)
 feat/xyz → main: draft PR opened once WO_1 is merged into feat/xyz; marked ready when all are merged
```

Each member is an ordinary Work order (Line, Cycles, delivery, Andon). The plan adds three things: a
way to declare the chain (§12.1–12.2), a base branch per member (§12.4–12.5), and an aggregate that
creates the branch and the plan PR (§12.3, §12.7).

### 12.1 Declaration

A todo may carry the optional frontmatter field `plan: <slug>`, with
`slug` matching `^[a-z0-9][a-z0-9-]{0,63}$`. The plan branch is `feat/<slug>`. Plan todos live on
`project.baseBranch` and intake reads them there, exactly as it reads any todo.

- The slug is unique per project for all time, like a `TodoId` (§2). Once a plan is `completed` or
  `cancelled`, or its PR is `ready`, a todo that names it gets the diagnostic `plan_closed` and
  creates nothing.
- `plan` is fixed when the Work order is created (`order_created.plan`). A later change of the
  field, or of the member's in-plan `depends_on` entry, on an existing member is ignored and
  reported as the diagnostic `plan_changed`.
- A todo without `plan` is unaffected by anything in this section.

### 12.2 Linear chain

Within one plan, the members form a single chain:

- every member has **at most one** `depends_on` entry that names a todo of the same plan;
- **exactly one** member, the root, has none;
- no member depends on a todo of **another plan** (a `depends_on` entry that names a member of a
  different plan is invalid; a dependency on a todo that is in no plan is an ordinary dependency);
- there is no cycle.

Intake validates this over all the plan's todos in the scan. A branch (two members sharing one
in-plan predecessor), a second root, a cycle or a cross-plan dependency makes **every todo of that
plan** carry the diagnostic `plan_invalid` (the detail names the offence), and **no Work order and no
plan** is created for it until the todos are fixed. For a plan that already exists, an invalid scan
creates no further member and changes none of the existing ones. Dependencies outside the plan keep
the normal rules (§8).

### 12.3 The Order Plan aggregate

An Order Plan has its own Traveler, with stream id `PlanId = <projectId>:plan:<slug>`, and is driven by
`decide` / `nextJob` like a Work order (RULES §1.2). It is created by intake before its first member.

```ts
interface PlanState {
  planId: PlanId;
  projectId: ProjectId;
  slug: PlanSlug;
  branch: string; // 'feat/<slug>'
  baseBranch: string; // the project's base branch when the plan was created
  phase: PlanPhase;
  members: PlanMember[]; // chain order, root first
  branchCommit?: CommitSha; // set by plan_branch_created
  pr?: { url: string; state: 'open' | 'merged' | 'closed' };
  activeJob?: {
    jobId: JobId;
    kind: PlanJobKind;
    cellId: CellId;
    epoch: number;
  };
  epoch: number; // the last issued epoch, 0 before any claim
  failures: { cellId: CellId; jobId: JobId; at: number }[]; // consecutive plan job failures
  andon?: { reason: PlanAndonReason; detail: string; at: number };
  resumedWaiting: boolean;
}

type PlanPhase =
  | { kind: 'branching' } // plan_created, no branch yet
  | { kind: 'active' } // the branch exists; no plan PR yet
  | { kind: 'pr_open' } // the draft (or ready) plan PR exists and is not merged
  | { kind: 'ready' } // the plan PR was marked ready
  | { kind: 'completed' } // the plan PR was merged
  | { kind: 'cancelled'; reason: string };

interface PlanMember {
  orderId: OrderId;
  todoId: TodoId;
  after?: OrderId; // the in-plan predecessor; absent for the root
  state: 'open' | 'delivered' | 'merged' | 'closed' | 'cancelled';
}

type PlanJobKind = 'plan_branch' | 'plan_pr' | 'plan_pr_ready';
type PlanAndonReason = 'plan_job_failed' | 'plan_pr_closed';
```

`member.state` is the member Work order's state as the plan last heard it: `open` (not delivered),
`delivered` (PR open), `merged`, `closed` (PR closed unmerged) or `cancelled`. The plan is a separate
stream, so it cannot read the member rows inside its own `decide`; the **runtime** reports changes with
`RecordMemberState` (§12.7). Because the plan only reads its own state, `decide`, `evolve` and
`nextJob` stay pure and the `plans` projection is a function of the plan's events alone.

**Events** (the catalogue of a plan Traveler; all follow §3.2):

| Event                       | Payload                                                               | Notes                                                                                                      |
| :-------------------------- | :-------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `plan_created`              | `projectId, slug, branch, baseBranch`                                 | `branch = 'feat/' + slug`. Phase `branching`.                                                              |
| `plan_member_added`         | `orderId, todoId, after?`                                             | Appended to `members` (§12.2: a member is added after the last one, or is the root).                       |
| `plan_member_state_changed` | `orderId, state`                                                      | The runtime's report of a member's state (§12.7).                                                          |
| `plan_branch_created`       | `commit`                                                              | `feat/<slug>` exists on the remote at `commit`. Phase `active`.                                            |
| `plan_pr_opened`            | `prUrl`                                                               | The draft plan PR exists. Phase `pr_open`.                                                                 |
| `plan_pr_ready`             | —                                                                     | The plan PR was marked ready. Phase `ready`.                                                               |
| `plan_pr_state_changed`     | `prUrl, state: 'open' \| 'merged' \| 'closed'`                        | From polling GitHub, like `pr_state_changed`.                                                              |
| `plan_completed`            | —                                                                     | **Decision event**: `decide(RecordPlanPrState{merged})` appends it with the state change. Terminal.        |
| `plan_cancelled`            | `reason`                                                              | Terminal.                                                                                                  |
| `job_claimed`               | `jobId, kind: PlanJobKind, cellId, epoch`                             | Same event as §3.3; `epoch = previous + 1`.                                                                |
| `job_lost`                  | `jobId, epoch, reason: 'lease_expired' \| 'cell_left' \| 'cancelled'` | Same event as §3.3.                                                                                        |
| `plan_job_failed`           | `jobId, kind, detail`                                                 | A plan job ended without its result. Ends the job and counts in `failures`.                                |
| `andon_raised`              | `reason: PlanAndonReason, detail`                                     | Decision event, as §3.3.                                                                                   |
| `resumed`                   | `resumeId, by, mode: { kind: 'retry_station' }`                       | Clears the Andon and `failures`; for `plan_pr_closed` also forgets the closed PR (phase back to `active`). |

`schemaVersion`, `seq`, `globalSeq`, `commandId`, `epoch` and `actor` work as in §3.1: a Cell writes
a plan event only under the epoch of its plan job.

**Evolve rules.** A job-ending event (`plan_branch_created`, `plan_pr_opened`, `plan_pr_ready`,
`plan_job_failed`, `job_lost`) clears `activeJob`. `plan_branch_created`, `plan_pr_opened` and
`plan_pr_ready` clear `failures`. `job_claimed` sets `activeJob` and `epoch` and clears
`resumedWaiting`. `plan_member_state_changed` sets that member's `state` only (a `merged` member
never goes back: later reports for it are inert). `plan_pr_state_changed` sets `pr.state`.

**Commands.**

| Command                     | Actor                    | Preconditions (else error)                                                                                                          | Emits                                                    |
| :-------------------------- | :----------------------- | :---------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------- |
| `CreatePlan`                | factory (intake)         | the plan does not exist                                                                                                             | `plan_created`                                           |
| `AddPlanMember`             | factory (intake)         | phase `branching`, `active` or `pr_open`; no member of that `orderId`; `after` is the last member, or absent and `members` is empty | `plan_member_added`                                      |
| `RecordMemberState`         | factory (runtime)        | the member exists; the state differs from the recorded one                                                                          | `plan_member_state_changed`                              |
| `ClaimJob`                  | factory (claim endpoint) | holder `queue`; `nextJob` is `job`                                                                                                  | `job_claimed{epoch+1}`                                   |
| `ReportPlanBranch`          | cell                     | epoch matches; job kind `plan_branch`                                                                                               | `plan_branch_created`                                    |
| `ReportPlanPr`              | cell                     | epoch matches; job kind `plan_pr`; **the root member is `merged`**                                                                  | `plan_pr_opened`                                         |
| `ReportPlanReady`           | cell                     | epoch matches; job kind `plan_pr_ready`; **every member is `merged`**                                                               | `plan_pr_ready`                                          |
| `ReportPlanJobFailed`       | cell                     | epoch matches                                                                                                                       | `plan_job_failed`                                        |
| `RecordPlanPrState`         | factory (intake)         | `pr` set; the state differs                                                                                                         | `plan_pr_state_changed` (+ `plan_completed` on `merged`) |
| `ExpireLease`, `ReleaseJob` | as §5.2                  | as §5.2, on the plan's `activeJob`                                                                                                  | `job_lost`                                               |
| `Resume`                    | supervisor, mechanic     | `andon` set                                                                                                                         | `resumed`                                                |
| `Cancel`                    | supervisor, mechanic     | phase not terminal                                                                                                                  | `plan_cancelled` (+ `job_lost{cancelled}` if active)     |

`Cancel` of a plan does not delete `feat/<slug>` or close any PR. The runtime then issues `Cancel` for
every member that is not yet `delivered`; members already delivered stay as they are and the Supervisor
closes their PRs on GitHub. A member that was cancelled leaves its dependents `deps_broken`
(§8), so the only repair in v2.0 for a plan with a cancelled member is to cancel the plan.

**`nextJob` for a plan.** A pure function of `PlanState`:

```ts
type PlanNext =
  | { kind: 'done' } // completed or cancelled
  | { kind: 'await_supervisor'; cause: 'andon' }
  | { kind: 'raise_andon'; reason: PlanAndonReason; detail: string }
  | { kind: 'wait_cell'; jobId: JobId; epoch: number }
  | { kind: 'wait_external' } // nothing to run until a member or the plan PR changes state
  | { kind: 'job'; job: { kind: PlanJobKind } }; // concrete JobId and epoch are assigned on ClaimJob
```

| #   | Condition                                                      | Result                        |
| :-- | :------------------------------------------------------------- | :---------------------------- |
| 1   | phase `completed` or `cancelled`                               | `done`                        |
| 2   | `activeJob` set                                                | `wait_cell`                   |
| 3   | `andon` set                                                    | `await_supervisor`            |
| 4   | `failures.length ≥ 2`                                          | `raise_andon plan_job_failed` |
| 5   | `pr.state = 'closed'` (closed unmerged)                        | `raise_andon plan_pr_closed`  |
| 6   | phase `branching`                                              | `job plan_branch`             |
| 7   | phase `active`, the root member is `merged`                    | `job plan_pr`                 |
| 8   | phase `pr_open`, every member `merged`                         | `job plan_pr_ready`           |
| 9   | anything else (members still running, a PR waiting for review) | `wait_external`               |

Row 7 is the only way a plan PR gets opened, and its condition is the root's `merged` state, so a plan
PR is never opened before the root is merged. Row 8 is reached with at least one member (the chain is
never empty once a plan has a branch, because a plan is only created together with its root). Plan
jobs are idempotent by contract (PROTOCOL §4): a retry or a takeover finds the branch or the PR and
reports it instead of creating a second one.

**Projection** (`plans`, STORAGE §4): `toProjection(planState)` gives the row: phase, members in chain
order with their states, branch and PR state, and the same `holder` / `next_kind` / `job_kind` columns as
an `orders` row (`holder` is `queue`, `cell`, `supervisor`, `members` for `wait_external`, or `none`).
Plan jobs sort ahead of Work order jobs in the queue (priority `high`, §12.6).

### 12.4 Stacked dependency

Inside a plan, a member's in-plan predecessor is satisfied when it is **`delivered` and its PR is not
`closed`**; the dependent need not wait for the merge. A predecessor whose PR was **closed unmerged**
makes the dependent `deps_broken` (never silently satisfied). This replaces `project.depPolicy` for
in-plan dependencies only, and is the stacked outcome in §8 (OPEN-QUESTIONS Q22). The root is the
exception: it has no in-plan predecessor but is gated by the plan branch (§12.6).

Why: a stack needs the predecessor's branch to exist and to be pushed, which is true from delivery;
waiting for a merge would serialise the chain on code review and defeat the stack.

### 12.5 Base of a plan Work order

The runtime resolves the base **branch** when it builds a job; it is **not stored** on the Work order:

| The member is…                                                         | Base branch                   |
| :--------------------------------------------------------------------- | :---------------------------- |
| the root                                                               | `feat/<slug>`                 |
| any member whose in-plan predecessor's PR is `merged`                  | `feat/<slug>`                 |
| any member whose predecessor is `delivered` and its PR is not `merged` | `factory/<predecessorTodoId>` |

"The predecessor's PR is `merged`" is the state in `orders.pr_state`; a reopened predecessor keeps
its `delivery`, so its dependents keep building on `factory/<predecessorTodoId>` while it is rework.
Station jobs use the base as `branch_base`, so the first job of a member starts from its tip. The
`deliver` job rebases the member's branch onto the base and opens its PR **against the base** (PROTOCOL
§4, §8.3). A non-plan Work order always uses its pinned `baseBranch`, never the project's current
one.

### 12.6 Queue rules for plans

- A Work order is claimable only when its `deps` are `satisfied` (§8). For the **root** of a plan,
  `deps` is also `waiting` until the plan row says `phase ≠ branching` (the branch exists). A plan
  whose Andon is not resolved therefore keeps its root waiting.
- A member's first claim needs its in-plan predecessor `delivered` with a PR not `closed` (§12.4).
- Plan jobs are queue entries too (`kind: 'plan'`): priority `high`, no runner, no required
  capability, and they do not count against the project's `maxRunning` (they run for seconds and need
  no worktree). They are claimed and fenced exactly like Work order jobs: a lease and an epoch,
  heartbeats, the reaper (PROTOCOL §5).

### 12.7 Runtime duties

The runtime keeps the two kinds of stream consistent. All of it is idempotent and replayable:

- **Create.** Intake creates the plan (`CreatePlan`), then each member in chain order
  (`CreateOrder` with `plan`, then `AddPlanMember`). Replaying a scan creates nothing twice.
- **Report member states.** After any event of a member that changes its state (`delivery_finished`,
  `pr_state_changed`, `cancelled`), the runtime appends `RecordMemberState` to the plan stream under
  the command id `<memberOrderId>:<member seq>:plan`. A start-up pass reconciles every non-terminal
  plan against its member rows, so a crash between the two appends loses nothing. The two appends are
  separate transactions: the plan may lag its members for a moment but never contradicts them.
- **Poll the plan PR.** `pr-poll` polls `pr.url` like a member's PR: `RecordPlanPrState`.
  `merged` yields `plan_completed`.
- **Build the plan PR text.** For `plan_pr` and `plan_pr_ready` the runtime renders title and body
  (the sub-PR list with titles, links and states) into a blob placed in the job.
- **Todos.** Each sub-PR removes its own todo on `feat/<slug>` (the deliver commit does it, PROTOCOL
  §8.3). The todos leave `main` with the final plan PR. Until then they are still on `main`, unchanged:
  intake MUST NOT report a plan Work order that is `delivered` or `merged` and whose todo content hash
  is unchanged as `reused_id`; it records it silently. A changed todo for such an order is still a
  diagnostic.

### 12.8 Reopen inside a stack

§8 stands: a reopened predecessor does not stop a dependent that has started. If the rewritten
predecessor (a new delivery commit, force-pushed to `factory/<predecessorTodoId>`) makes the
dependent's delivery rebase conflict, the deliver job reports `delivery_failed` and the Andon goes to
the Supervisor (via the Mechanic, §4.3). There is **no automatic restack in v2.0**
(OPEN-QUESTIONS Q24). A deliver job whose base branch no longer exists on the remote (for example,
the predecessor was merged and its branch deleted in between) also reports `delivery_failed`; a
`Resume` rebuilds the job with the now-correct base (`feat/<slug>`).

### 12.9 Merge strategy

Sub-PRs into `feat/<slug>` are merged with a **merge commit**, and their head branch is **deleted on
merge**. GitHub then retargets the next PR in the stack to `feat/<slug>`, and the commit the Cell
delivered is unchanged, so the stack does not conflict. **Squash is only for the final PR into
`main`.** The Cell still squashes each member's own checkpoints into one commit at delivery
(OPEN-QUESTIONS Q12); that is per Work order and is unrelated to how its PR is merged. The repository
settings this needs are in [ORDER-PLAN.md](ORDER-PLAN.md) (OPEN-QUESTIONS Q23).

### 12.10 Invariants

| ID  | Invariant                                                                                                                                                                                                                         |
| :-- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **One PR per member.** Each member has at most one PR (delivery finds the PR for its branch before opening one) and the plan has at most one live plan PR: a second `plan_pr_opened` needs a closed PR and a `Resume` in between. |
| P2  | **No early plan PR.** `plan_pr_opened` is applied only when the root member's `state` is `merged`; a Cell cannot open it earlier (`ReportPlanPr` is refused).                                                                     |
| P3  | **Root waits for the branch.** A root Work order is never claimable while its plan's phase is `branching`.                                                                                                                        |
| P4  | **Linear chain.** In every created plan, each member has at most one in-plan predecessor and exactly one has none; `members` has no duplicate.                                                                                    |
| P5  | **Ready means merged.** `plan_pr_ready` is applied only after `plan_pr_opened`, and only when every member is `merged`; `plan_completed` only after `plan_pr_opened`.                                                             |
| P6  | **Plan fencing.** The single-writer and monotone-epoch rules (I4, I5) and "late facts are inert" (I3, for a job that ended) hold for plan streams: at most one `activeJob`, strictly increasing `epoch`.                          |
| P7  | **No silent stop for plans.** For every non-terminal plan state, `nextJob ≠ done`; `raise_andon` is followed by `await_supervisor`; after `resumed`, `nextJob` is not the Andon it cleared.                                       |

P1–P7 are property-tested with I1–I9 (RULES §1.4); P3 is a queue test over a generated set of plan and
member rows.

## 13. Testing

| Level    | What                                                                                                                            | Tool                               |
| :------- | :------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------- |
| Unit     | `evolve` per event, `decide` per command and per error, `nextJob` per table row (§6 and §12.3), `select` ordering               | vitest                             |
| Scenario | `given(events).when(command).then(events)` and `given(events).nextJob(expected)`; every v1 scenario rewritten here (ROADMAP M1) | vitest + harness in `core/testing` |
| Property | I1–I9, I11 and P1–P7 over generated command sequences against a generated Line (and generated plans)                            | fast-check                         |
| Contract | One suite run against the fake and the SQLite `EventStore` (I10, concurrency)                                                   | vitest                             |

## 14. Mechanic (M10)

The Mechanic is the on-call operator for Andons (`decisions/20261113-230000-factory-mechanic-andon-triage.md`).
It triages each Andon, may repair the workflow, and records what it did. This section says what is
built and what is still specified.

### 14.1 Status

| Part                                                                                                                                 | Status                                                            |
| :----------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------- |
| Actor `mechanic`; `incident_recorded`; `RecordIncident`; the mechanic authority (§14.3); the Mechanic's `Resume` and `Cancel` guards | Built in `factory-core` (M10 slice 1)                             |
| Supervisor `Resume` and `Cancel` record their own incident when the Andon has none (§14.5)                                           | Built in `factory-core` (M10 slice 2)                             |
| `mechanic` job kind; the `nextJob` row 3 split; `mechanicRuns` budget; `escalate_andon` and `EscalateAndon` (§14.4)                  | Built in `factory-core` (M10 slice 2)                             |
| Contracts: `mechanic` job block; operator verbs `incident` and `escalate`                                                            | Built (M10 slice 2)                                               |
| Runtime: the Mechanic job built from `incident.md` (`buildIncidentPrompt`); the factory escalation on a spent budget                 | Built (M10 slice 2)                                               |
| operator-cli verbs `incident` and `escalate`; CLI `show` and `log` show incidents                                                    | Built (M10 slice 2)                                               |
| Cell: the Mechanic pane run in a repair checkout; the worktree guard; the trust-screen known case (§14.6)                            | Built (M10 slice 3), unit-tested with fake Herdr and fake runtime |
| Distributed `factory-m10` scenarios                                                                                                  | Not built                                                         |

### 14.2 Incident

`incident_recorded { incidentId, by, andonAt, andonReason, diagnosis, action, changes[], outcome }`

- `andonAt` is the `at` of the `andon_raised` the incident triaged. An Andon has **at most one**
  incident, and it is recorded before the Andon is cleared (I12).
- `action` is `resume | cancel | nudge | escalate | repair`. Only `repair` carries `changes`; the
  other actions carry none. Each change is `{ kind: 'file' | 'config', path, ref }`, where `ref` is a
  commit sha (a Line, Operator or Cell file in the definitions repo) or a blob (a config blob). At most 16.
- `RecordIncident` (actor `mechanic`) is refused when the Work order is terminal, when no Andon is
  open, when the open Andon already has an incident, when a `repair` names no change, when a
  non-repair names one, or when a blob ref does not exist (`invalid`).
- `factory show` and `factory log` show the incidents of a Work order (pending: CLI).

### 14.3 Authority

- The Mechanic may run `RecordIncident`, `Resume`, `Cancel`, `Nudge` and `Answer`. Any other command
  refuses it with `precondition`, the same as any actor that is not allowed to run it.
- The Mechanic's `Resume` applies only when the incident of the open Andon exists (I12). A refusal
  says `the mechanic records the incident before it resumes`.
- The Mechanic never edits the Work order's worktree. No core command changes a worktree; the Cell
  gives a Mechanic job no workspace (`prepareWorkspace` refuses it), runs it in a repair checkout
  under the Cell's data dir, and accepts only the `incident` and `escalate` verbs from it (§14.4).
- The Cell sends the Mechanic's `RecordIncident`, `Resume`, `Cancel` and `Nudge` under the actor
  `mechanic`; every other command from a Cell keeps the Cell's own actor.
- Only the Supervisor may `Reopen` and `Reprioritise`.

### 14.4 Mechanic job and budget

- **Triage.** Every Andon starts with `triage: 'mechanic'` (`andon_raised`). An `incident_recorded`
  with `action: escalate` sets `triage: 'supervisor'`. The holder is `mechanic` while the Andon is
  triaged by the Mechanic and has no incident; otherwise it is `supervisor` (§4.2).
- **Job kind** `mechanic`: no workspace, no station. Its job block carries `andonAt`, the attempt `n`
  and the prompt blob (`incident.md`, rendered from the Andon reason and detail by
  `buildIncidentPrompt`). A claim of it has no Cycle and counts one `mechanicRuns`, lost or not.
  Its incident ends it: `incident_recorded` clears the active job when that job is a Mechanic job.
- **`nextJob` row 3** (after the busy row 2): an open Andon returns
  - `await_supervisor` when `triage` is `supervisor`, or when an incident already exists for it;
  - `job mechanic` when `mechanicRuns < MECHANIC_BUDGET` (2);
  - `escalate_andon` otherwise. The factory then appends `EscalateAndon` (actor `factory`), which
    records an incident with `by: 'factory'` and `action: escalate`, so the Supervisor gets the Andon
    with its incident attached.
- **Cell run.** The Cell runs the Mechanic in a Herdr pane (PROTOCOL §9) with the prompt blob, its
  working directory the repair checkout, never a worktree. The runner is the Line's first Operator
  pool, carried in the job's `mechanic.operator` block. The socket takes `incident` and `escalate`;
  every other verb is refused with `precondition`. Each verb is submitted under the job's epoch, so a
  stale Mechanic is fenced out.
- **Follow-up.** An incident with `resume` or `repair` is followed by `Resume` (`retry_station`); with
  `cancel` by `Cancel`; with `nudge` by `Nudge`. An `escalate` is followed by nothing. A refused
  follow-up is reported to the Mechanic, and the incident stays recorded.
- **No incident.** A pane that exits, or runs past the job's `timeoutMs`, with no incident submits
  nothing. The lease lapses, and the reaper counts the run against the budget.
- **Lost jobs.** A Mechanic job that is lost (lease expired, Cell left) releases the job and keeps its
  budget spent. The next `nextJob` runs another Mechanic job, or escalates. Nothing stops silently.
- **Holder and queue.** The queue selects a Work order whose holder is `mechanic` and whose `next` is
  a job, like a queued one (CORE §8).

### 14.5 Supervisor and the incident rule

- The Supervisor's `Resume` or `Cancel` of an Andon with no incident records one in the same decision
  (`action: resume` or `cancel`, `by` the Supervisor's name), before `resumed` or `cancelled`. So no
  Andon is cleared without an incident (I12) and no runtime step is needed for it.
- The Supervisor's `Resume` is refused while a Mechanic job works on the Andon. The Mechanic's own
  `Cancel` is refused until its incident is recorded.

### 14.6 Open points

- **Trust-screen known case.** A Herdr start refused as `agent_not_ready` while the agent sits on the
  folder-trust screen is confirmed by the Cell (Enter on the highlighted trust option) and started
  once more. Any other refusal keeps its error. A Mechanic whose own pane is held by that screen
  therefore runs on, records its incident and resumes the Work order, with no Supervisor command.
- **Not yet built.** The `factory-m10` distributed scenarios (Andon to Mechanic resume; budget spent
  to the Supervisor; the trust-screen case end to end through the runtime). The Cell tests drive the
  run with a fake Herdr and a fake runtime, so the end-to-end proof is still open.
- **Live intervention** (stall alerts, `Answer` during a Cycle; `decisions/20261114-112011`) is not in
  M10. It is specified in a later M10 pass.
