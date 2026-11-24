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
| Supervisor (`sf`, web) to HQ | outbound | supervisor token |
| Factory to HQ | outbound only | Factory credential (`factory_session`) |
| Cell to Factory | loopback only | local bearer, memory only; Factory relays |
| Cell to HQ | none | none |

No open port on local PC.

## Ownership

- HQ: projects, orders, jobs, queue, leases, Factory registry.
- Factory: HQ credential, running Cells, local logs, project to repo-path map. In memory only except credential.
- Cell: one worktree use, one runner process.

## Setup

1. `sf hq start`: starts HQ. Admin token: `sf hq token admin create --save`.
2. `sf hq token create --kind factory_join --name <n>`: one-time join token, scope `factory:enroll`.
3. PC: `sf factory connect <url> --token <join>`: exchanged for the Factory credential, one file `0600` (`$XDG_CONFIG_HOME/sf/factory.json`).
4. `sf factory start`.
5. In repo: `sf cell scale N`.

Supervisor token and join token stay separate.

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
- HQ answers 401 for the Factory credential: kill all Cells, stop, user runs `sf factory connect` again. Cells have no HQ credential of their own.

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

## Done

- Removed: drain and force signals, `leaveCell`, handover, per-Cell token, `revoked` status, `sf cell revoke`, `pinned_cell_id`.
- DB: `jobs.claimed_by_cell_id` plain text, no foreign key. `work_orders.pinned_factory_id`. No Cell table; migration `0006_cell_identity_drop` rebuilt `safe_tokens` without Cell token kinds.
- Code renames: `apps/hq`, `@repo/hq-contracts`, `HQ_*` env (`FACTORY_*` fallback), `hq.db` (`factory.db` fallback), `apps/factory/src/` (Factory daemon, formerly `apps/sf/src/factory/`).

## Gaps

| Gap | Where |
| --- | --- |
| One long-poll per idle Cell, not one per Factory. HQ caps waiters at 5 globally (`MAX_CLAIM_WAITERS`); a 6th idle Cell gets an empty reply at once and spins | `apps/hq/src/adapters/memory/claim-waiters.adapter.ts`, `apps/factory/src/relay.ts` |
| Claim wait hardcoded 25 s, not configurable for proxy timeouts | `CLAIM_WAIT_MS` in `apps/hq/src/config.ts`, `apps/sf/src/config.ts` |
| Relay 401 kills only the calling Cell; others die at next HQ heartbeat (up to 10 s) | `apps/factory/src/relay.ts` |
| Factory does not watch Cell worktrees; a deleted worktree is seen only at next resume | `apps/factory/src/` |
| Scale-down "newest" sorts by Cell start, not step start (`activity.since` is sent but unused) | `killOrder` in `apps/factory/src/scaler.ts` |
| `sf service install --cell` writes a unit running `sf cell start --project`; Cells refuse without the Factory and `--project` is gone. Needs a Factory daemon unit | `apps/sf/src/adapters/cli/service.command.ts` |
| Worktrees of cancelled orders are never removed | `apps/sf` (only deliver and discard remove) |
| `.factory/templates/pr/blocked.md` unused; no draft PR for blocked work | `.factory/templates/pr/` |
| Verify: after `worktree_missing` reset, fresh Step 0 job may carry the old `headCommitSha` (not cleared in the reset patch) | `apps/hq/src/application/procedures/jobs/transition-job.procedure.ts` |
| HQ hosting: Google e2-micro fits by estimate, not tested | ops |
| CI never runs install or quickstart | [onboarding-plan.md](./onboarding-plan.md) |
