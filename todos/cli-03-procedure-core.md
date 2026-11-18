---
status: todo
factory: v2
plan: factory-cli
depends_on: [cli-02-contracts]
priority: high
line: feature
type: feat
---

# Todo: `cli-03-procedure-core` — Procedures, Ports and Context Wiring

## 🎯 Objective

Build the procedure factory and the port set so that every command is a procedure with an access rule, and every I/O goes through a port picked in `bootstrap/`.

---

## 🌐 Context & Problem Statement

- Each command is a procedure (PLAN §2). The procedure says who may run it (`supervisor`, `cell`, `job`) and what input it takes.
- The access rule must be enforced in one place, so a `cell` procedure cannot run with supervisor credentials, and an operator verb cannot read the supervisor token.
- The server already does this in `apps/factory-server/src/application/core/procedure.ts` (see factory-server `step-01-procedure-access-model`). The CLI copies the idea, not the code.
- Without ports, tests would need a real server, a real git and a real runner. Ports make every procedure testable with fakes.

---

## 📦 Specification / Scope

- **Target**: `apps/factory/src/application/`, `apps/factory/src/bootstrap/`.
- **Classification**: `Domain Core` (procedures and ports, no adapters).
- **Files to create**:
  - `src/application/core/procedure.ts`
  - `src/application/core/errors.ts` (`Refused`, `ArgumentError`, `Unreachable`)
  - `src/application/ports/server.port.ts`
  - `src/application/ports/clock.port.ts`
  - `src/application/ports/fs.port.ts`
  - `src/application/ports/git.port.ts`
  - `src/application/ports/runner.port.ts`
  - `src/application/ports/process.port.ts`
  - `src/application/ports/operator-endpoint.port.ts`
  - `src/application/ports/token-store.port.ts`
  - `src/bootstrap/context.ts`
  - `src/bootstrap/run.ts`
  - `test/unit/application/procedure.test.ts`
- **Dependencies**: none added.

---

## 🛠️ Implementation Plan

1. **Types first** (declaration order rule):
   - `type Access = { kind: 'supervisor' } | { kind: 'cell'; cellId: CellId } | { kind: 'job'; jobId: JobId; role: 'operator' | 'mechanic'; epoch: number }`
   - `type Context<A extends Access>`: the ports, plus `principal` typed from `A`.
   - `type Procedure<I, O>`: `{ access: Access; parse: (raw: unknown) => I; execute: (input: I, ctx: Context<Access>) => Promise<O> }`
2. **Private helpers**:
   - `authorize(access, ctx)`: for `supervisor`, the `ctx.token.kind` must be `supervisor`. For `cell`, the token kind must be `cell` and its id must equal `access.cellId`. For `job`, the token must map to the same `jobId` and `role`. Failure throws `Refused` with message `Token cannot run this procedure`.
   - `checkAccess` is the only place a cast may appear, and only after `authorize` succeeds.
3. **`define(access)(schema)(handler)`** returns `{ access, parse, execute }`. `execute` calls `authorize` first, then `parse`, then `handler`. Parse errors throw `ArgumentError`.
4. **Ports** are TypeScript interfaces only. Each port lists the methods later steps need. Examples:
   - `ServerPort`: `call(route, body, token)`, `stream(route, query, token)`.
   - `FsPort`: `readText(path)`, `writeText(path, text, mode?)`, `exists(path)`, `readStdin()`.
   - `TokenStorePort`: `read()`, `write(token)`, `clear()`.
   - `OperatorEndpointPort`: `open(jobId, handler)`, `close()`.
   - `RunnerPort`: `start(spec)`, `abort(handle)`, `wait(handle)`.
   - `GitPort`, `ProcessPort`, `ClockPort`: signatures only in this step.
5. **`bootstrap/context.ts`**: `buildContext(mode)` where `mode` is `'supervisor' | 'cell' | 'operator'`. It returns the port set for that mode. Adapters are not created here yet; this step returns in-memory stubs that throw `Error('port not wired')`. Real adapters arrive in later steps.
6. **`bootstrap/run.ts`**: `run(procedure, input, mode)` builds the context, calls `execute`, and maps errors to exit codes through `domain/exit-codes.ts`.

---

## ✅ Acceptance Criteria

- [ ] A `cell` procedure run with a supervisor token is refused with `Token cannot run this procedure` (exit `1`).
- [ ] A `job` procedure run with a token for another job is refused.
- [ ] A bad argument raises `ArgumentError` and the mapped exit code is `2`.
- [ ] `execute` never runs the handler when `authorize` fails (unit test with a counting fake).
- [ ] Casts appear only in `checkAccess` / `authorize`.
- [ ] `application/` imports no adapter and no Node built-in I/O module (checked by a boundary test in `test/unit`).
- [ ] No `any`; no barrel file.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md): unit test output.
