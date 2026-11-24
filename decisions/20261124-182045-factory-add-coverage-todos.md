---
scope: factory/sf
summary: Add todos for job coverage, plan e2e, doctor rule and plan verb
why: Plan branch shipped untested end to end, and the audit could not catch a missing consumer
date: 2026-11-24
---

- Queue `sf-job-kind-coverage`: fail when a job kind has no Cell handler.
- Queue `sf-plan-branch-e2e`: activate a plan on a real remote and run its root order.
- Queue `doctor-cross-boundary-rule`: audit must name the consumer of new job kinds and states.
- Queue `sf-plan-activate-verb`: add `sf plan` activate, retry and show commands.
