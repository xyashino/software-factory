---
scope: factory
summary: Remove dead operator app and protocol package
why: apps/operator had no registered verbs, bin or importers; sf operator already ships client and Cell endpoint
date: 2026-11-21
tags: [cleanup, contracts]
---

- Delete `apps/operator` and `packages/operator-protocol`; lockfile loses both importers.
- `sf operator` stays the only implementation, one contract in `apps/sf/src/contracts/operator.contract.ts`.
- Adopt protocol limits in sf contract: token 16-256 chars, feedback/handover/report 65536, reason 8192.
- Token limit safe: Cell issues 16 random bytes as 32 hex chars (`run-job.procedure`).
- Body cap: loopback `maxRequestBodySize` 1 MiB, same as old `MAX_BODY_BYTES`.
- `.strict()` already present in sf contract; reply schemas not ported (sf maps by status only).
- Ported tests to `apps/sf/test`: non-JSON reply, undefined status, 400/401/500 refusal, invalid URL, limits.
- Dropped on purpose: reply-shape-vs-status check (sf has none), client timeout case (fixed 10 s, too slow), `boundaries` tests (app gone).
- Invalid `FACTORY_OPERATOR_URL` now exits 3 (unreachable), not 2; sends nothing either way.
- Move `PLAN.md` to `apps/sf/docs/OPERATOR.md` with glossary and four client rules; drop operator README and IMPLEMENTATION_RULES.
- Repoint `drift.test.ts`, sf PLAN links, root README; replace stale refs in todos and docs.
- Env var renames stay out of scope.
