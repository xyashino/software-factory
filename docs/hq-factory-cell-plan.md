# hq factory cell plan

## Goal

One brain (HQ), one local supervisor per PC (Factory), disposable workers (Cells). Clean edges, one credential place, simple cleanup. Design only. No code changed yet.

## Names

| Name | Is | Replaces |
| --- | --- | --- |
| HQ | external server: state, queue, projects, orders | "Factory" (external) |
| Factory | local daemon, one per PC | "Cell Server" |
| Cell | disposable worker slot, one job at a time | Cell (less identity) |
| Line | pipeline template `.factory/lines/*.yml` | unchanged |
| Project | repo with `.factory/config.json` | unchanged |

Domain words for users: WorkOrder, Line, Station, Job. HQ/Factory/Cell only in setup and ops docs.

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

1. `sf hq start`: prints admin token once. Today `sf server start`.
2. `sf hq token create --join`: one-time join token. Cell join tokens exist today (`sf token create --kind cell_join`, scope `cell:enroll`; `/tokens/join` is the web join, not this). New: `factory_join` kind for Factories.
3. PC: `sf factory connect <url> --token <join>`: exchanged for machine credential, one file `0600`.
4. `sf factory start`.
5. In repo: `sf cell scale N`.

Operator token and join token stay separate.

## Repo gate

- `sf cell scale` works only inside a repo with `.factory/config.json`. No project flag. Outside a repo: refuse. Today `sf cell create --project` allows outside a repo; remove.
- Project id from config `project`. Unknown on HQ: refuse. Create with `sf project add <id> --repo`.
- One repo path per project per Factory. Second clone refused, message names registered path.

## Cell lifecycle

```
scale up -> idle -> running -> idle ...
 idle / running -> gone   (scale down, crash, Factory lost HQ)
```

- No drain, no handover, no `deleted` status, no `revoked` status. Gone means no row. `sf cell revoke` removed.
- Cell id random per run, not stored in HQ, no token. Today id = project + name, stored, 30 day session token.
- Orders pin to Factory (`pinned_factory_id`), not Cell.
- Job lease belongs to Factory slot.

## Connection

- Idle Cell: long-poll claim via Factory, `waitMs` up to 25 s. HQ wakes waiters in memory (`wakeAll`). Fine with one HQ.
- Running: heartbeat every 10 s, lease 60 s. Reply carries `abort`.
- Factory holds one long-poll to HQ for all Cells (target). Today one per Cell.
- Claim wait must stay under proxy timeout. Make configurable.
- Factory lost HQ for 45 s: kill all Cells. HQ reaps at lease expiry (60 s). Kill must come before reap, else dying Cell and new Cell overlap. Today `SELF_FENCE_MS` 45 s is defined but unused in `apps/sf/src`; Cell aborts after 4 failed heartbeats (about 40 s).
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
- Today `checkpointStation` commits and pushes after every operator step with files or changes. Must change to builder only.
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

## Today vs plan

| Plan | Today |
| --- | --- |
| Factory daemon | `sf factory start\|stop\|status` on `127.0.0.1:7072`; spawns and kills Cells in memory. Replaces `apps/cell` and `slots.json` (ADR `20261122-165116`) |
| Factory entity in HQ | None. "Factories" in the removed `apps/cell` meant HQ targets |
| `sf cell scale N` | `sf cell create --count N`, `stop`, `rm`; slots in `slots.json` |
| Random Cell id, no token | `projectId` + name, stored, 30 day token |
| Builder-only commit | Every operator step commits and pushes |
| Reset to `headCommitSha` | No `git reset` or `clean` in `apps/sf` |
| Atomic step files | Atomic only for slot and connection files |
| Worktree check | Exists: `.cell/worktree.json`, `.cell/<station>/state.json`, then `worktree_missing` |
| Lease reaper | Exists: expired jobs go through `loseJob`, silent Cells go `offline` |

## Open

- `loseJob` bumps `epoch`? Not read.
- SQLite table rebuild for FK changes? Not checked.
- Cleanup of worktrees of cancelled or delivered orders: no code removes them today (`worktreeRemove` is unused in `apps/sf`).
- Free hosting for HQ: Google e2-micro fits by estimate, not tested. Build binary off the VM.

## Order

One parent each. Specs in `todos/`, each self-contained.

| Todo | What | Parent |
| --- | --- | --- |
| `hq-rename-docs` | New names in docs and CLI help, old commands as warned aliases | none |
| `step-files-atomic` | Atomic `.cell/` files, `state.json` written last | none |
| `checkpoint-builder-only` | Commit and push only after builder; discard dirt from others | step-files-atomic |
| `cell-resume-check` | Reset to `headCommitSha`, else scratch | checkpoint-builder-only |
| `factory-daemon-sf` | `sf factory` daemon, replaces `apps/cell` and `slots.json` | none |
| `factory-hq-link` | Factory entity in HQ, join token, credential file, 45 s loss rule | factory-daemon-sf |
| `factory-relay` | Cells talk only to Factory, which relays to HQ | factory-hq-link |
| `cell-gone-transaction` | Kill, confirm exit, delete Cell, requeue, epoch bump | factory-relay |
| `cell-scale-command` | `sf cell scale N`, repo gate, scale-down order | cell-gone-transaction |
| `factory-workspace-watch` | Worktree check on tick, report `worktree_missing` | cell-scale-command |
| `cell-identity-slim` | Random Cell id, no row, no token, pin to Factory | cell-gone-transaction |
| `cell-drain-removal` | Delete drain, force, leave, handover | cell-identity-slim |
