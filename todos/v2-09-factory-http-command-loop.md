---
status: todo
priority: high
depends_on:
  [v2-05-definitions, v2-06-queue-selection, v2-08-storage-leases-blobs-export]
workflow: feature
---

# v2-09: Factory — HTTP, auth, command loop, claim, heartbeat, reaper, prompts

## Objective

Make `factory-server` a working control plane for Cells: authenticated HTTP, the single command
loop, claim with continuation, heartbeat with signals, the lease reaper, and server-side prompt
rendering.

## Read first

- `docs/PROTOCOL.md` §1–7 (credentials, APIs, errors, `Job`, leases, idempotency, signals)
- `docs/STORAGE.md` §3 (continuation inside one transaction)
- `docs/CORE.md` §1 (the write loop), §6, §7
- `docs/STRUCTURE.md` §1 (`apps/server` layout), `docs/RULES.md` §3–5
- v1: `packages/software-factory/src/prompts/*`

## Scope (ROADMAP items)

`factory-m4-http`, `factory-m4-command-loop`, `factory-m4-claim-reaper`, `factory-m4-prompts`.

## Deliverables

1. Hono app: auth middleware for supervisor tokens, join tokens and Cell credentials (hashes only);
   error mapping of PROTOCOL §3.5; `factory-server admin token create <name>`.
2. Supervisor endpoints needed now: `/v1/board`, `/v1/orders/:id`, `/v1/orders/:id/events`,
   `/v1/orders/:id/{answer,resume,reopen,nudge,cancel,priority}`, `/v1/blobs/:ref`, `/v1/cells`,
   `/v1/join-tokens`.
3. `handle-command.ts`: load → evolve → decide → nextJob → `andon_raised` → project → append;
   conflict retry (3, then 503); per-order in-process serialisation; `dryRun`; continuation
   claimed in the same transaction with `next` stored in the idempotent response.
4. Cell endpoints: `join`, `hello`, `claim` (long-poll ≤ 25 s, PROTOCOL §5.2), `heartbeat`
   (per-job `ok | stale`, signals, acks), blob GET/PUT, `jobs/:jobId/commands`.
5. Reaper (5 s) and boot grace; Cell revocation expiring its leases.
6. Prompt rendering: `CycleContext` + Operator profile + templates → prompt blob; runtime prompts
   into `Job.station.runtimePrompts`; relative paths only.

## Out of scope

Intake, SSE stream, admin backup/export/import, e2e (v2-10).

## Acceptance criteria

- HTTP tests per endpoint and per error mapping, against SQLite in a temp dir.
- Tests: duplicate `commandId` returns the stored response including `next`; stale epoch → 409;
  dry run appends nothing; expired lease → `cycle_failed{lost}` + `job_lost`.
- Prompt snapshots for each Line Station contain no absolute path.
- `pnpm turbo check-types lint test` green.
