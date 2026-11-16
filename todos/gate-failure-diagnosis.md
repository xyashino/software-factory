---
status: todo
priority: high
depends_on: []
line: feature
type: feat
---

# Todo: Record why the quality gate failed and who is at fault

## 🎯 Objective

When the quality gate fails, store extra diagnostic output that shows whether the cause is the builder's code, the prompts, or the environment, so the next retry can be aimed at the right place.

---

## 🌐 Context & Problem Statement

The `quality-gate` inspection in `.factory/lines/feature.yml` runs `pnpm check-types`, `pnpm lint`, `pnpm test` and `pnpm nitpick:check`. When one fails, the Cell records only the exit code and a short status line (`inspection_progress ✗ pnpm test exit 127`). The full output is stored as a log blob, but no station reads it on purpose, and the retry loop sends the failure back to `build` with no diagnosis.

Concrete example from a real cycle: `pnpm test` exited 127 in under a second, and `nitpick:check` failed on the commit message and a missing ADR. Those are environment and commit-format problems, not builder code problems. The builder retried anyway, because the gate gave no way to tell them apart.

Without a diagnosis step, every failure looks the same. The team can't tell whether to fix the prompt, the environment, or the builder's work, so retries repeat the same mistake.

---

## 📦 Specification / Scope

- **Target**: `.factory/lines/feature.yml` (new station), `.factory/operators/` (new profile), `apps/cell/src/jobs/run-inspection.ts` (what the gate keeps), `packages/factory-definitions/src/line-schema.ts` if a new artifact key is needed.
- **Classification**: `Domain Core` / `Integration`
- **Dependencies**:
  - `plan-reviewer` profile already exists in `.factory/operators/` (not used by `feature.yml` yet). Reuse it, or add a dedicated `gate-diagnoser` profile (decision open, see below).

Decisions to confirm before implementing:

1. Use the existing `plan-reviewer` profile, or add a dedicated `gate-diagnoser` profile?
2. Run the diagnosis station only on gate failure (retry path), or on every cycle?

Decided:

- On gate failure, `quality-gate.onFail.retry` points to the diagnosis station, not to `build`. `build` runs again only after the diagnosis, and it receives `diagnosis.md`.

---

## 🛠️ Implementation Plan

1. **Keep the evidence**:
   - The gate artifact (`quality-gate.gate`) includes, per check: command, exit code, duration, and the last N lines of output (stderr first).
   - Full output stays in the log blob, referenced by ref. The artifact points to it.
2. **Add the diagnosis station**:
   - New `kind: operator` station placed after `build` and before `quality-gate`, retried from the gate (see the earlier retry example).
   - Its inputs are only earlier stations: `build.report`, `build.commit`, `plan.plan`. It reads the failing check's output from the retry context, not from `quality-gate.gate` (a later station).
3. **Write the diagnosis**: the operator writes one artifact, `diagnosis.md`, with one of these verdicts per failing check:
   - `builder`: the code or tests are wrong, retry the builder with the excerpt.
   - `prompt`: the instructions were wrong or ambiguous, name the prompt file.
   - `environment`: a missing binary, PATH, or setup step, name the command.
   - `commit-format`: the commit message or ADR, name the rule.
4. **Feed the verdict forward**: the next `build` attempt receives `diagnosis.md` as input, so the builder knows what to change or not to touch.
5. **Surface it**: the diagnosis appears in the cycle log so an operator reading the run sees the cause without opening the blob.

---

## ✅ Acceptance Criteria

- [ ] A failing `pnpm test` exit 127 is reported with its command and the PATH error text, not just the exit code.
- [ ] `diagnosis.md` classifies every failing check as one of `builder`, `prompt`, `environment`, `commit-format`.
- [ ] The retried `build` station receives `diagnosis.md` as an input.
- [ ] The new station's inputs come only from earlier stations; `factory check` passes on the edited line.
- [ ] A passing gate runs no diagnosis station (decision 2 applied).
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Exactly one new `decisions/` entry for this change.
