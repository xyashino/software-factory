# HQ, Factory & Cell Plan

## Goal

One brain (HQ), one local supervisor per PC (Factory), disposable workers (Cells). Clean edges, one credential place, simple cleanup.

## Names

| Name | Is | Replaces |
| :--- | :--- | :--- |
| HQ | External server: state, queue, projects, orders | "Factory" (external) |
| Factory | Local daemon, one per PC | "Cell Server" |
| Cell | Disposable worker slot, one job at a time | Cell (less identity) |
| Line | Pipeline template `.factory/lines/*.yml` | unchanged |
| Project | Repo with `.factory/config.json` | unchanged |

Status: built except [Gaps](#gaps) below. Full specs: [cells-and-factory.md](../features/cells-and-factory.md), [hq.md](../apps/hq.md).

## Edges & Ownership

| Edge | Direction | Credential |
| :--- | :--- | :--- |
| Supervisor (`sf`, web) to HQ | outbound | supervisor token |
| Factory to HQ | outbound only | Factory credential (`factory_session`) |
| Cell to Factory | loopback only | local bearer, memory only; Factory relays |
| Cell to HQ | none | none |

- **HQ**: projects, orders, jobs, queue, leases, Factory registry.
- **Factory**: HQ credential, running Cells, local logs, project-to-repo path map. In memory only except credential.
- **Cell**: one worktree use, one runner process.

## Gaps

| Gap | Where |
| :--- | :--- |
| One long-poll per idle Cell, not one per Factory. HQ caps waiters at 5 globally (`MAX_CLAIM_WAITERS`); 6th idle Cell gets empty reply at once and spins | `apps/hq/src/adapters/memory/claim-waiters.adapter.ts`, `apps/sf/src/factory/relay.ts` |
| Claim wait hardcoded 25s, not configurable for proxy timeouts | `CLAIM_WAIT_MS` in `apps/hq/src/config.ts`, `apps/sf/src/config.ts` |
| Relay 401 kills only calling Cell; others die at next HQ heartbeat (up to 10s) | `apps/sf/src/factory/relay.ts` |
| Factory does not watch Cell worktrees; deleted worktree seen only at next resume | `apps/sf/src/factory/` |
| Scale-down "newest" sorts by Cell start, not step start (`activity.since` sent but unused) | `killOrder` in `apps/sf/src/factory/scaler.ts` |
| `sf service install --cell` writes unit running `sf cell start --project`; needs Factory daemon unit | `apps/sf/src/adapters/cli/service.command.ts` |
| Worktrees of cancelled orders never removed | `apps/sf` (only deliver and discard remove) |
| `.factory/templates/pr/blocked.md` unused; no draft PR for blocked work | `.factory/templates/pr/` |
| Verify: after `worktree_missing` reset, fresh Step 0 job may carry old `headCommitSha` | `apps/hq/src/application/procedures/jobs/transition-job.procedure.ts` |
| HQ hosting: Google e2-micro fits by estimate, not tested | ops |
| CI never runs install or quickstart | [onboarding-plan.md](./onboarding-plan.md) |
