Path: `decisions/YYYYMMDD-HHmmss-[<TICKET>-]<slug>.md` (e.g. `decisions/YYYYMMDD-HHmmss-[<TICKET>-]<scope-prefix>-<verb>-<object>.md`). `YYYYMMDD-HHmmss` = real local datetime when written.

```yaml
---
ticket: <ABC-123> # optional, omit if no tracker; "none" is rejected
scope: <scope>
summary: <10-70 chars summary>
why: <10-200 chars motivation>
date: YYYY-MM-DD
tags: [<kebab-tag-1>, <kebab-tag-2>]
---
- Change bullet 1
  - Nested bullet...
- Change bullet 2
```

- required: `scope`, `summary` (10-70 chars), `why` (10-200 chars), `date` (YYYY-MM-DD), `tags` ([<kebab-tag>])
- optional: `ticket` (id like `ABC-123`, uppercase only; omit key and filename segment if untracked), `supersedes` (full name of older entry without `decisions/` and `.md`, e.g. `YYYYMMDD-HHmmss-<slug>`)
- optional metrics, only if known from the conversation, skip otherwise: `models`, `inputTokens`, `outTokens`, `cost`, `workTimeInMinutes`
- body: only nested `- ` list, no heading, prose or code fence
- bounds and allowed scopes: `packages/nitpick/src/rules/decision-log.md`, `.nitpick/config.ts`
