---
scope: factory
summary: v2 PRs use the v1 format and the builder's commit
why: v2 PRs were titled with the todo id and their body was the raw todo; v1 PRs read as a reviewable summary with changes, ADR and checks
date: 2026-11-15
tags: [v2, delivery, pr, cell]
---

- The deliver job takes its commit message and PR title from the builder's `commit` artifact (the Line's `deliver.commit`); a missing or malformed one falls back to the generated commit.
- The PR body renders the shipped `templates/pr/body.md`: objective, change list, ADR, checklist of every Inspection command and Operator station, event log command, report excerpt.
- The Cell fills the ADR section (`PR_ADR_TOKEN`) with the `decisions/` entries the delivery commit adds.
- The builder updates its existing decision entry on later attempts, so a multi-attempt task still ships exactly one.
