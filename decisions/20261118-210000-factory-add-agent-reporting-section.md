---
scope: factory/operator
summary: Add agent reporting section to factory-server docs and rebase operator docs on it
why: The operator docs cited the old root docs, which are being deleted, and had no source for the endpoint or the retry rule.
date: 2026-11-18
tags: [factory, operator, mechanic, docs, idempotency]
---

- `apps/factory-server/docs/PLAN.md` §11 (new): per-job loopback endpoint, token mapping, verb-to-server-call table, reply codes, `commandId` derived by the Cell, report rule, open questions.
- Retry rule: the CLI sends no `commandId` and never retries on its own. The Cell derives `sha256(jobId + epoch + verb + payload)`, so a retry with the same arguments returns the stored result (BE_RULES §4.4).
- `apps/operator/docs` rewritten against §11. No references to the root `docs/`.
- Mechanic `answer` and Operator `context` and `tell` marked open: the new core has no question entity, so `answer` has no target.
- `incident --action escalate` replaces the separate `escalate` command.
- `apps/operator-cli` code is unchanged. Its gap to the plan is in the operator docs.
