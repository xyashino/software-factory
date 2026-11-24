---
scope: factory
summary: Confirm the Doctor requires a consumer for new job kinds and states
why: The Doctor passed an HQ plan_branch change with no Cell side because nothing in the diff pointed at the missing consumer
date: 2026-11-24
---

- Task asked for a Doctor Blocking item and Instructions step for new job kinds, states and payload fields without a consumer.
- Already shipped in `6339a24` (#262): `.factory/operators/doctor.md` Blocking item and Instructions step 6 match the acceptance criteria.
- No `doctor.md` edit in this change. Rule stays a text check; the Doctor runs no commands.
- `bun run nitpick:check` needed this entry to pass; it is the only file added.
