---
scope: factory/core
summary: Add core events, state, evolve and projection
why: One fold defines the v2 Traveler; the spec gaps that decide and nextJob build on are recorded here
date: 2026-11-13
tags: [v2, core, events, factory]
---

- Event catalogue: all 26 events of CORE §3.3 as strict zod discriminated union; envelope `schemaVersion: 2`; upcaster is identity for v2, unknown versions are errors
- Free text capped at 4 KiB UTF-8 (`tail` 2 KiB); checked in bytes with TextEncoder
- I2 in `src/machine-local.ts`: paths, hostnames, pane ids, pids on free text, names and ids; host:port only on free text
- I2 exception: `prUrl` (https only) is checked for shape, not for machine-local values; `BlobRef` and `CommitSha` are regex-checked
- `order_created.line` carries the Line inline as `snapshot` plus `snapshotBlob` as audit ref: evolve is pure and cannot read a blob (CORE §4.4)
- `spec_updated` may replace the pinned line with its own inline snapshot; `line.name` and `line.hash` must match the snapshot
- State adds `todoId` (needed for the `todo_id` column); `cycle_failed.wipCommit` and `order_created.baseBranch` stay in events only
- Per-Station counters (`retriesUsed`, `retryGrants`, `restartsUsed`, `lostRestartsUsed`) start at zero for every Station of the Line
- `lastPassed` is `Partial`: an absent Station has not passed or was rewound by `restart_from` or `reopened`
- Checkpoint after `restart_from(s)`: the newest checkpoint of a Station before `s`, found through `lastPassed`; `reopened` uses the delivered commit
- `progressed` = at least one Station passed (CORE §8 comment), not "a Cycle started"; a claimed first job does not count
- `last_cell_id` = cell of the latest Cycle, else the cell of the last workspace failure
- `station_id` and `station_index` = Station of the next job, else the Station the phase points at; `runner` only for operator jobs
- `avoid_cells` from `workspaceFailures` with `WORKSPACE_COOLDOWN_MS` = 10 min; one entry per cell, latest cooldown kept
- Andon Station for `retryGrants` = Station of the latest Cycle
- `usage_recorded` and `question_answered` apply whatever the Cycle status; events about an unknown Cycle or question are inert
- Invariant breaks throw, never skip: a history not starting with `order_created`, a second `order_created`, an unknown Station id
- `workspace_failed`, `job_lost`, `delivery_*` and `cycle_started` act only when their job is the active one
- `OrderProjection` holds typed values (arrays, booleans, nulls); the factory-db adapter serialises the JSON columns
- `Next` and `JobSpec` are type-only in `order/next.ts`; `nextJob` itself is a later todo (v2-03)
- Ports only, no fakes: `EventStore`, `StoreTx`, `BlobStore`, `LeaseStore`, `Clock`, `Ids`
- No re-export barrel files: modules are imported by relative path inside the package (CORE §1 layout, NEVER barrel rule)
