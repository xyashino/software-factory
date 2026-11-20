---
scope: factory
summary: Clean PR body with task objective, inline ADR and repo checks
why: PRs showed hardcoded notes, an empty Event log line and a duplicated title, with no ADR text or real checks
date: 2026-11-20
tags: [factory, pr, templates]
---

- PR body template is now `Task`, `Changes`, `ADR`, `Checks` with icon headings; no `sf`, cell or `Event log:` text.
  - `PR_TEMPLATE_VARS.body` is `taskId`, `objective`, `changes`, `adrSection`, `verificationSection`.
  - Repo, starter and `sf init` templates updated together.
- `formatPrBody` in `factory-runtime` no longer fills `typeSuffix`, `logCommand` or the Cell report; `apps/cell` render drops those inputs.
- `apps/factory` `domain/git/pr-body.ts`: `extractObjective`, `formatAdrEntries`, `formatChecks`.
- `deliverStation` always lists added `decisions/*.md`, passes task description and inspection `exec` commands to `deliverWorkOrder`.
  - `requireAdr` still demands exactly one new entry.
- `deliverWorkOrder` reads each ADR file from the worktree and inlines its link, `summary`, `why` and body.
