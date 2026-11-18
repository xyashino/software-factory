---
status: todo
factory: v2
plan: operator-cli
depends_on: [step-02-operator-client-exit-codes]
priority: high
line: feature
type: feat
---

# Todo: `step-03-operator-define-verb-cli` — Verb Pipeline and CLI Shell

## 🎯 Objective

Create `defineVerb`, the single pipeline every verb uses, and the `cli.ts` shell that registers verbs by explicit import.

---

## 🌐 Context & Problem Statement

- Every verb does the same steps: parse arguments, read files, build the request, send it. Writing that once keeps verb files free of I/O (IMPLEMENTATION_RULES §4.2).
- The CLI registers verbs by explicit import, not a barrel file (repo rule `coding-no-barrel-export`).

---

## 📦 Specification / Scope

- **Target**:
  - `apps/operator/src/verbs/define-verb.ts`: `defineVerb({ name, args, readFiles, toRequest })`
  - `apps/operator/src/cli.ts`: citty root command; registers verbs by explicit import
  - `apps/operator/src/usage.ts`: help text for every verb
  - `apps/operator/src/__tests__/cli.test.ts`
- **Boundary**: `apps/operator/src/` only.
- **Classification**: `Unit` for `defineVerb`; `Black-box` for the CLI through a test stub Cell.
- **Dependencies**: `citty: catalog:` (already used by `apps/operator-cli`).

---

## 🛠️ Implementation Plan

1. `defineVerb` returns a verb object. Its run function: parse args with the verb's zod schema, read every file named in `readFiles` (required or optional), call `toRequest(args, files)`, send through `client.ts`, print the outcome through `exit-codes.ts`.
2. Syntactic checks only: required flags present, enum values valid, files readable. No Line or job-state checks (PLAN §5).
3. `cli.ts` imports each verb module directly and registers it. Unknown options are rejected before any request is sent.
4. `usage.ts` lists every verb and its options. `--help` prints it.

---

## ✅ Acceptance Criteria

- [ ] A verb with no files sends exactly one request.
- [ ] A required file that is missing gives exit `2` and sends no request.
- [ ] An unknown option gives exit `2` and sends no request.
- [ ] `--help` lists every registered verb.
- [ ] `cli.ts` has no barrel import; each verb is imported by its path.
- [ ] No `any`; no `as unknown as`.
- [ ] `pnpm --filter @repo/factory-operator-cli check-types`, `lint`, `test` pass.
- [ ] One new ADR entry in `decisions/`.
- [ ] Evidence recorded per `.agents/skills/evidence/SKILL.md`.
