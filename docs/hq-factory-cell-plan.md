# hq factory cell plan

## Goal

One brain (HQ), one local supervisor per PC (Factory), disposable workers (Cells). Clean edges, one credential place, simple cleanup.

## Names

| Name | Is | Replaces |
| --- | --- | --- |
| HQ | external server: state, queue, projects, orders | "Factory" (external) |
| Factory | local daemon, one per PC | "Cell Server" |
| Cell | disposable worker slot, one job at a time | Cell (less identity) |
| Line | pipeline template `.factory/lines/*.yml` | unchanged |
| Project | repo with `.factory/config.json` | unchanged |

Domain words for users: WorkOrder, Line, Station, Job. HQ/Factory/Cell only in setup and ops docs.

Status: the design is built except the Gaps below.

## Edges

| Edge | Direction | Credential |
| --- | --- | --- |
| Operator (`sf`, web) to HQ | outbound | operator token |
| Factory to HQ | outbound only | machine credential |
| Cell to Factory | loopback only | none stored; Factory relays |
| Cell to HQ | none | none |

No open port on local PC.

## Ownership

- HQ: projects, orders, jobs, queue, leases, Factory registry.
- Factory: HQ credential, running Cells, local logs, project to repo-path map. In memory only except credential.
- Cell: one worktree use, one runner process.

## Setup

1. `sf hq start`: starts HQ. Admin token: `sf hq token admin create --save`.
2. `sf hq token create --kind factory_join --name <n>`: one-time join token, scope `factory:enroll`.
3. PC: `sf factory connect <url> --token <join>`: exchanged for machine credential, one file `0600`.
4. `sf factory start`.
5. In repo: `sf cell scale N`.

Operator token and join token stay separate.

## Repo gate

- `sf cell scale` works only inside a repo with `.factory/config.json`. No project flag. Outside a repo: refuse.
- Project id from config `project`. Unknown on HQ: refuse. Create with `sf project add <id> --repo`.
- One repo path per project per Factory. Second clone refused, message names registered path.

## Cell lifecycle

```
scale up -> idle -> running -> idle ...
 idle / running -> gone   (scale down, crash, Factory lost HQ)
```

- No drain, no handover, no `deleted` status, no `revoked` status. Gone means no row. `sf cell revoke` removed.
- Cell id random per run, not stored in HQ, no token.
- Orders pin to Factory (`pinned_factory_id`), not Cell.
- Job lease belongs to Factory slot.

## Connection

- Idle Cell: long-poll claim via Factory, `waitMs` up to 25 s. HQ wakes waiters in memory (`wakeAll`). Fine with one HQ.
- Running: heartbeat every 10 s, lease 60 s. Reply carries `abort`.
- Factory holds one long-poll to HQ for all Cells. See Gaps.
- Claim wait must stay under proxy timeout. Make configurable.
- Factory lost HQ for 45 s: kill all Cells. HQ reaps at lease expiry (60 s). Kill must come before reap, else dying Cell and new Cell overlap.
- Upstream 401 for a Cell session: Factory re-enrolls that Cell once, then kills it. 401 for the Factory credential: kill all Cells, stop, user runs `sf factory connect` again. Cells never see either.

## Gone Cell cleanup

Factory order, always:
1. Kill process. Confirm exit.
2. End lease.

HQ one transaction per job of that Cell in `claimed`/`running`:
1. Job back to queued, partial result dropped.
2. Clear order cell fields. Order to `queued`.
3. Bump `epoch`.

Kill first, requeue second. Else new Cell may share worktree with dying process. `epoch` rejects late results.

## Resume on claim

```
no worktree, step 0     -> start
no worktree, step > 0   -> worktree_missing -> HQ resets to step 0
worktree exists         -> prior step files complete? yes: resume. no: delete worktree, scratch
```

- Worktree is `<repo>/.worktrees/<orderSlug>`: per order, not per Cell. Retry reuses it (`workspaceMode: reuse`).
- Hard rule: only builder edits code. No commit per step. Builder commits once per build attempt (`build.commit`). Other operators write only `.cell/` files, never committed.
- Resume target is order `headCommitSha`: base commit before first build, last build commit after. Retry build starts on the previous build commit.
- Step output files written atomically (temp then rename). Exists means complete.
- Killed in read-only step or inspection: rerun step, drop partial files, worktree already clean.
- Killed in build: hard reset to `headCommitSha`, clean, rerun build.
- Killed after build: `build.commit` recorded, resume next step.
- Commit missing or reset fails: delete worktree, scratch.
- Resume only same PC and repo. Read-only step files are not committed, so they exist only locally.
- Deleting a Cell does not count toward `MAX_WORKTREE_RESETS` (2). Real `worktree_missing` does.

## Scale

`sf cell scale N` sets desired count for this repo project. Factory starts or kills to match. Count in memory: reboot or HQ loss resets to 0.

Scale down order:
1. Idle Cells.
2. Running Cells in read-only step or inspection.
3. Running Cells in build, newest build first (least work lost).

Kill is immediate. Cleanup as above. No capacity cap. HQ shows count per Factory.

## Workspace watch

- Factory checks each Cell worktree exists on every heartbeat tick (10 s).
- Removed: kill Cell, report `worktree_missing`. Counts toward cap.
- Logs live outside worktree. Already true: local slot logs in `$XDG_DATA_HOME/sf/cells/<slot>.log`. Removal keeps the preview.

## Code to remove

Removed in `cell-drain-removal`: `drain` and `force` signals, `leaveCell`, draining state, handover path, per-Cell token, `revoked` status and `sf cell revoke`, `pinned_cell_id`. Drain was fixed 2026-11-21 (ADR `20261121-175500`); this reverses it.

## DB change

- `jobs.cell_id`: plain text, no foreign key. History survives.
- `work_orders.pinned_cell_id` to `pinned_factory_id`.
- Cell rows and tokens go away.

## Gaps

Still open vs plan:

- Factory does not watch Cell worktrees. `apps/sf/src/daemon/` has no worktree check (see Workspace watch).
- One long-poll per idle Cell, not one per Factory. HQ caps waiters at `MAX_CLAIM_WAITERS = 5` (`apps/factory/src/config.ts:14`), global.
- `CLAIM_WAIT_MS` hardcoded 25 s in `apps/factory/src/config.ts:4` and `apps/sf/src/config.ts:43`.
- Relay 401 kills one Cell (`apps/sf/src/daemon/relay.ts`), not all.

## Open

- SQLite table rebuild for FK changes? Not checked.
- Worktree removal runs on deliver and run-job (`apps/sf/src/application/procedures/cell/deliver.procedure.ts:77`, `run-job.procedure.ts:649`). Cancelled orders: not checked.
- Free hosting for HQ: Google e2-micro fits by estimate, not tested. Build binary off the VM.
