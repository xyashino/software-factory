---
scope: factory/server
summary: Claim eligibility and ordering as pure domain functions
why: Cells need one tested rule set for which work order they may claim, with no DB or HTTP code.
date: 2026-11-18
tags: [factory, cells, domain]
---

- `isEligible` checks queued state, no active cell or job, project match, line allowance, unavailable line cells, pin affinity and `max_running`.
- `selectClaimable` filters candidates by eligibility and returns a new array ordered warm first, then priority high > medium > low, then oldest `createdAt`.
- Warm means pinned to this cell or listed in the cell's local worktrees.
- Line allowance accepts `'*'` as a wildcard.
- A pin to another cell is ignored when the flag says that cell is offline or its lease expired.
- Domain types are plain objects; `db/schema` is not imported.
- Input candidates are not mutated.
- Unit tests cover each eligibility rule and each ordering tie-break.
