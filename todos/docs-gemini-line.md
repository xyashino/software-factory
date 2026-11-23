---
status: queued
priority: low
line: gemini
type: docs
---

# docs-gemini-line: document gemini line in docs

## Objective

Add a brief description of the `gemini` line in `docs/sf.md` so users know how to run production lines with the Gemini runner (`antigravity`).

## Scope

- **Target**: `docs/sf.md`
- **Classification**: `Documentation`

## Acceptance Criteria

- [ ] `docs/sf.md` mentions the `gemini` line alongside `fast`, `feature`, and `standard`.
- [ ] `bun run ci:verify` passes.
- [ ] One new decision entry in `decisions/`.
