---
status: todo
priority: high
depends_on: []
type: feat
---

# Todo: software-factory Autonomous Operator (Self-Healing & Repair)

## 🎯 Objective

Transform the On-Call Operator from a passive, read-only triage role into an active self-healing agent that can edit files, repair failed code, unblock infrastructure/runner stalls, and fight to keep production moving before escalating to blocked.

---

## 🌐 Context & Problem Statement

Currently, the On-Call Operator is severely constrained:

1. **Strict Read-Only Enforcement**: RULES 5.6 and `settleOperator` mandate that the operator must not edit files. If the worktree differs from the pre-operator snapshot, the supervisor records `blocked infra "operator changed worktree"` and immediately publishes a draft `[BLOCKED]` PR.
2. **Restricted `sf unblock`**: The `unblock` command explicitly forbids unblocking `infra`, `no_retry`, or `setup_failed` blocks, and limits retry budget extensions to exactly 1 extra attempt. When an agent stalls or crashes after a restart, the operator has no tool to retry the step and is forced to escalate.
3. **Runner Stalls on Interactive Prompts**: The operator agent (e.g. running under Cursor `--auto-review` or Claude with interactive tools) frequently prompts in the terminal. The supervisor's observer detects this as `agent: 'blocked'` and aborts the operator after ~17 seconds with `stalled: blocked on a runner prompt`.
4. **Defeatist Role Instructions**: `roles/operator.md` advises: _"When unsure, escalate."_

When operating unattended, these limitations cause the operator to fail or escalate almost immediately, leaving fixable tasks blocked. The operator should act as an autonomous engineer: diagnose the error, fix syntax/types/tests, unblock or restart the failed step, and only escalate when truly stuck.

---

## 📦 Specification / Scope

- **Target**: `packages/software-factory/{roles/operator.md,src/supervisor/operator.ts,src/supervisor/observe.ts,src/cli/commands/unblock.ts,workflows/*.yml,docs/RULES.md}`
- **Key Deliverables**:
  - Allow the operator to stage/commit fixes in the task worktree (or unblock the failed step cleanly).
  - Loosen `settleOperator` so that changes made by the operator are evaluated (e.g. by rerunning verification or resuming the step) rather than immediately failing with `operator changed worktree`.
  - Extend `sf unblock` capabilities so the operator can retry or unblock infra/stalled steps when it has fixed the cause.
  - Fix runner stall false-positives for interactive operator agents.
  - Update `roles/operator.md` with active triage, repair, and unblock guidance.
