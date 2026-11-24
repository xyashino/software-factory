---
scope: factory
summary: Make the Doctor require a consumer for new job kinds and states
why: The Doctor passed an HQ plan_branch change with no Cell side because nothing in the diff pointed at the missing consumer
date: 2026-11-24
---

- `doctor.md` adds a Blocking item: new job kind, work-order state or payload field with no consumer in the diff and no test.
- Instructions step 6 names each new producer and finds its consumer in the diff or context; absent consumer fails with the producer's file and line.
- Text check only: the Doctor still runs no commands.
- Runtime checks stay out of scope and belong in `sf-job-kind-coverage`.
