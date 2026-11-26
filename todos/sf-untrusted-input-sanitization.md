---
status: delivered
priority: medium
line: standard
type: feat
---

# sf-untrusted-input-sanitization: strip Unicode control/bidi chars from operator prompts

## Objective

Sanitize untrusted text (`todos/*.md` descriptions, incident notes, handover payloads) by stripping Unicode control and bidi override characters before persisting or interpolating them into AI operator prompts.

## Context

Inspired by Parka's receipt OCR hardening (`src/server/application/shared/receipt-reader.ts`). Hidden Unicode bidi/control characters (`\p{C}` excluding `\n`, `\r`, `\t`) can conceal prompt-injection instructions inside markdown todos or PR comments fed to autonomous Cells.

## Scope

- **Target**: `packages/prompt/src/`, `apps/hq/src/domain/queue/todo-markdown.ts`, `apps/sf/src/application/`, `packages/prompt/src/__tests__/`
- **Classification**: `Security`, `Domain Core`

## Implementation Plan

1. **Sanitizer Utility (`packages/prompt/src/sanitize.ts`)**:
   - Export pure `sanitizeUntrustedText(input: string): string` stripping Unicode control/format/bidi characters (`\p{Cc}`, `\p{Cf}`) while preserving printable text, tabs, and newlines.
2. **Apply at Ingestion & Prompt Boundaries**:
   - Apply in `todo-markdown.ts` on todo title/description parsing and in `packages/prompt` template helpers when rendering untrusted work-order or incident fields.
3. **Tests**:
   - Add unit tests in `packages/prompt/src/__tests__/sanitize.test.ts` covering bidi overrides (`\u202E`), zero-width joiners/null bytes (`\u0000`, `\u200B`), and preservation of normal UTF-8/markdown/newlines.

## Acceptance Criteria

- [ ] Bidi override, null, and invisible control characters are stripped cleanly.
- [ ] Normal ASCII, Polish/Unicode text, markdown formatting, and newlines remain intact.
- [ ] Unit tests pass in `packages/prompt` and `apps/hq`.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
