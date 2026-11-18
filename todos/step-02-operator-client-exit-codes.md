---
status: todo
factory: v2
plan: operator-cli
depends_on: [step-01-operator-protocol-package]
priority: high
line: feature
type: feat
---

# Todo: `step-02-operator-client-exit-codes` — Client, Exit Codes and File Reading

## 🎯 Objective

Build the transport client, the status-to-exit-code mapping, and the file reader that the operator CLI uses for every verb.

---

## 🌐 Context & Problem Statement

- One request per invocation. The CLI never retries; the agent decides (`apps/operator/docs/PLAN.md` §6).
- Exit codes are CLI-only: `0` ok, `1` refused, `2` bad arguments or environment, `3` unreachable or unreadable (PLAN §4).
- Transport is isolated in `client.ts`, so a later change to a Unix socket touches one file (IMPLEMENTATION_RULES §5.2).

---

## 📦 Specification / Scope

- **Target**:
  - `apps/operator/src/client.ts`: one `POST /` with JSON `{ verb, ...fields, token }` to `FACTORY_OPERATOR_URL`
  - `apps/operator/src/exit-codes.ts`: status and failure to exit code
  - `apps/operator/src/files.ts`: read `--feedback`, `--handover`, `--report` as UTF-8; `-` reads stdin
  - `apps/operator/src/__tests__/stub-cell.ts`: local HTTP server that answers each status code on demand
  - `apps/operator/src/__tests__/client.test.ts`, `files.test.ts`
- **Boundary**: `apps/operator/src/` only. May import `packages/operator-protocol`. Must not import `apps/cell`, `apps/factory-server`, or `packages/factory-*`.
- **Classification**: `Integration` for `client.ts` (against the stub Cell); `Unit` for `exit-codes.ts` and `files.ts`.
- **Behaviour**:
  - `200` -> exit `0`, print `ok: true`
  - `400`, `401`, `409`, `500` -> exit `1`, print `code: message` from the reply
  - connection refused, timeout, or unreadable reply -> exit `3`
  - missing env var, missing file, bad args -> exit `2`, and no request is sent
  - the token is never printed, including in errors and debug output

---

## 🛠️ Implementation Plan

1. `exit-codes.ts`: pure mapping from a result (`ok`, `refused`, `argument_error`, `unreachable`) to a number.
2. `files.ts`: read a path as UTF-8; `-` reads all of stdin; a missing or unreadable file is an argument error (exit `2`).
3. `client.ts`: read `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN`; a missing variable is exit `2` before any request. Send one request. Map the HTTP status and body to a result.
4. `stub-cell.ts`: a local server with a scripted response per test.
5. Tests as black-box through `client.ts` and the stub Cell, AAA layout, story-style names.

---

## ✅ Acceptance Criteria

- [ ] `200` -> exit `0` and `ok: true`.
- [ ] `400`, `401`, `409`, `500` -> exit `1` and `code: message` from the reply.
- [ ] Connection refused -> exit `3`.
- [ ] Missing env var or missing file -> exit `2`, and the stub Cell receives no request.
- [ ] Exactly one request per invocation, even on exit `3`.
- [ ] The token never appears in stdout, stderr, or error text.
- [ ] No barrel `index.ts`; no `any`.
- [ ] `pnpm --filter @repo/factory-operator-cli check-types`, `lint`, `test` pass.
- [ ] One new ADR entry in `decisions/`.
- [ ] Evidence recorded per `.agents/skills/evidence/SKILL.md`.
