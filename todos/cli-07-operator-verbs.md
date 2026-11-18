---
status: todo
factory: v2
plan: factory-cli
depends_on: [cli-06-incidents-orders-watch]
priority: high
line: feature
type: feat
---

# Todo: `cli-07-operator-verbs` — `factory operator` for Agents

## 🎯 Objective

Give agents running inside a job one command, `factory operator <verb>`, that reports to their own Cell and nothing else. It replaces the separate `apps/operator` binary.

---

## 🌐 Context & Problem Statement

- An agent in a station job reports `done`, `verdict`, `block` and `context`. An agent in a Mechanic job reports `read` and `incident` (`apps/operator/docs/PLAN.md` §3, `apps/factory-server/docs/PLAN.md` §11).
- The agent's shell has only `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN`. The command must not read `.factory/`, the supervisor token or any other config (`apps/factory/docs/PLAN.md` §4).
- The CLI is a thin client. The Cell checks the token and the role. The server decides the state change. The CLI checks syntax only (`apps/operator/docs/PLAN.md` §5).
- No retries. The CLI sends one request. The agent decides whether to retry (`apps/operator/docs/PLAN.md` §6).
- Open verbs `answer`, `tell` and `ask` are not built (`apps/factory-server/docs/PLAN.md` §11.6). `context` is in the command table, so it is built. Drop it later if the open decision removes it.

---

## 📦 Specification / Scope

- **Target**: `apps/factory/src/application/procedures/operator/`, `apps/factory/src/adapters/cli/operator.command.ts`, `apps/factory/src/adapters/operator-client/`, `apps/factory/src/adapters/fs/operator-files.ts`.
- **Classification**: `Integration`.
- **Files to create**:
  - `src/application/procedures/operator/done.procedure.ts`
  - `src/application/procedures/operator/verdict.procedure.ts` (`pass` and `fail`)
  - `src/application/procedures/operator/block.procedure.ts`
  - `src/application/procedures/operator/context.procedure.ts`
  - `src/application/procedures/operator/read.procedure.ts`
  - `src/application/procedures/operator/incident.procedure.ts`
  - `src/adapters/operator-client/client.ts` (one `POST /` with JSON, implements `OperatorEndpointClient`)
  - `src/adapters/operator-client/exit-map.ts` (status to exit code)
  - `src/adapters/fs/operator-files.ts` (`--feedback`, `--handover`, `--report`; `-` reads stdin)
  - `src/adapters/cli/operator.command.ts`
  - `test/blackbox/operator-verbs.test.ts`, `test/unit/adapters/operator-files.test.ts`
- **Dependencies**: none added. Uses `contracts/operator.contract.ts` (cli-02).

---

## 🛠️ Implementation Plan

1. **Environment**: read `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN` only. Missing one is exit `2`, and no request is sent. Never read `.factory/`, `FACTORY_TOKEN` or the token file.
2. **Verbs and options**:
   - `done`: no options.
   - `verdict pass`: no options.
   - `verdict fail --feedback <file>`: file is read as UTF-8; `-` reads stdin.
   - `block --reason "<why>" --handover <file>`: both required.
   - `context`: no options. Prints the job's inputs and outputs the Cell returns.
   - `read`: no options. Prints the incident, step states, and logs the Cell returns.
   - `incident --action <action> [--step <id>] --diagnosis "<what>" --outcome "<what he tried>" --report <file>`: `--step` required for `restart_from_step`. `--report` required.
3. **Syntax checks only**: flag presence, enum values, file readable, `-` as stdin. Anything about the Line, job state or step list is the server's, and the CLI does not repeat it.
4. **One request**: `POST /` with `{ verb, ...fields, token }`. The token is sent in the body and in `Authorization: Bearer`, as the Cell expects.
5. **Exit codes**: `200` -> `0`, print `ok: true`. `400`, `401`, `409`, `500` -> `1`, print `code: message` from the reply, with no extra wording. Connection failure or unreadable reply -> `3`. Bad args, missing env, missing file -> `2`, nothing sent.
6. **Secrets**: the token is never printed, including in errors and debug output.

---

## ✅ Acceptance Criteria

- [ ] `factory operator done` sends exactly one request with `verb: done`.
- [ ] `verdict fail` without `--feedback` exits `2` and sends nothing.
- [ ] `block` without `--reason` exits `2` and sends nothing.
- [ ] `incident --action restart_from_step` without `--step` exits `2`.
- [ ] `incident` with an action outside the five values exits `2`.
- [ ] `answer`, `tell`, `ask`, `resume`, `nudge`, `repair` and `--change` do not exist (help output checked).
- [ ] A `409` reply prints `code: message` and exits `1`.
- [ ] Stub endpoint refused -> exit `3`.
- [ ] No read of `.factory/`, `FACTORY_TOKEN` or the token file (test with a fake fs that fails on those paths).
- [ ] The token never appears in stdout, stderr or error text.
- [ ] No barrel file; no `any`.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md): a stub Cell run covering exit `0`, `1`, `2`, `3`.
