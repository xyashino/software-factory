---
scope: factory
summary: Gate delivery on clean tree and configurable ADR entry
why: v1 refused pushes with dirty trees or a missing decisions entry; v2 did not
date: 2026-11-16
---

- deliver: after the delivery commit, `git status --porcelain` (excluding `.cell/`) must be empty, else the delivery is refused
- deliver: `deliver.requireAdr: true` refuses unless the commit adds exactly one `decisions/*.md` entry
- Line schema, snapshot, Job contract and job builder carry `requireAdr`, default off
- `feature.yml` and `standard.yml` set `requireAdr: true`; `fast.yml` stays off
- Golden hashes of the feature and standard lines updated for the new snapshot field
