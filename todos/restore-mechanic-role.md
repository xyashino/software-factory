---
status: todo
priority: high
depends_on: []
line: feature
type: feat
---

# Todo: Restore the mechanic role and its per-feature record

## 🎯 Objective

Give the Mechanic its own operator profile in `.factory/operators/`, and restore the record of its findings at the root of each feature, as the v1 operator did.

---

## 🌐 Context & Problem Statement

v1 had an on-call role, `packages/software-factory/roles/operator.md`, for triaging a blocked run. It is the same job the v2 Mechanic does (v1 called it "operator"; v2 uses "operator" for the station role). v1 wrote its report and logs under `.evidences/<taskId>/`, the feature's root folder: `supervisor.log`, `notify.log`, `blocked-pr.log`, plus per-attempt folders. v1 had no file named "mechanic" anywhere, so the feature to restore is that root-level record.

Current v2 state, checked in this repo:

- `.factory/operators/` has `builder.md`, `doctor.md`, `planner.md`, `plan-reviewer.md`. There is no mechanic profile.
- `packages/factory-runtime/src/job-builder.ts` (around line 230) runs the mechanic job with **the Line's first operator pool** ("The Mechanic runs with the Line's first Operator pool"). The Mechanic therefore uses a builder/planner profile, not a triage profile.
- Incidents are stored only as events and blobs (`WorkOrderState.incidents`, `incident_recorded`). There is no per-feature file at the root.

Without a dedicated profile, the Mechanic gets the wrong instructions and model. Without the root record, a human cannot read what it found by looking at the feature folder.

---

## 📦 Specification / Scope

- **Target**: `.factory/operators/mechanic.md` (new), `.factory/lines/feature.yml` (operator pool), `packages/factory-runtime/src/job-builder.ts` (operator selection for mechanic jobs), `apps/cell/src/jobs/run-mechanic.ts` (where the record is written).
- **Classification**: `Domain Core` / `Integration`
- **Dependencies**: the existing mechanic job and `RecordIncident` command. No new port.

Decisions to confirm before implementing:

1. **Where is the root record?** Option A: `.evidences/<taskId>/mechanic.md` in the Work order's repo checkout, as v1 did. Option B: a blob ref in the events only (current behaviour, no file). This todo assumes A.
2. **Which operator runs the Mechanic?** Option A: a dedicated `mechanic` pool in `operators:`, selected by name. Option B: keep the first-station fallback. This todo assumes A.

---

## 🛠️ Implementation Plan

1. **Profile**: add `.factory/operators/mechanic.md` with the front matter used by the other profiles (`id`, `label`, `artifacts: { report: report.md }`). Port the v1 instructions: triage one Andon, read the incident and log, decide one resolution, never edit the worktree. Keep the v2 command set (`RecordIncident`, `Nudge`, `Answer`, `Cancel`, `escalate`).
2. **Line**: add a `mechanic` pool under `operators:` in `.factory/lines/feature.yml` (and `standard.yml`, `fast.yml`), with its runner, model and timeout.
3. **Selection**: `job-builder.ts` picks the pool named `mechanic` instead of the first station's operator. Refuse with a clear message when the Line has no `mechanic` pool.
4. **Root record**: after the incident is recorded, write `.evidences/<taskId>/mechanic.md` with the incident reason, the Mechanic's decision and the commands it ran. Append one section per Andon; never overwrite.
5. **Docs**: update `docs/CORE.md` §14.4 (which pool runs the Mechanic) and the Line schema notes.

---

## ✅ Acceptance Criteria

- [ ] `.factory/operators/mechanic.md` exists and `factory check` accepts it.
- [ ] A mechanic job runs with the `mechanic` pool, not the first station's pool.
- [ ] A Line without a `mechanic` pool refuses the mechanic job with a clear precondition message.
- [ ] Each recorded incident appends one section to `.evidences/<taskId>/mechanic.md`; earlier sections are kept.
- [ ] The Mechanic still cannot edit the worktree or push git branches (existing CORE §14.3 rule).
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Exactly one new `decisions/` entry for this change.
