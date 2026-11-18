---
status: todo
factory: v2
plan: factory-cli
depends_on: [cli-08-cell-lifecycle]
priority: high
line: feature
type: feat
---

# Todo: `cli-09-runners` — Five Headless Runner Adapters

## 🎯 Objective

Add the five runners the Cell can start for a station: `claude`, `codex`, `cursor`, `antigravity`, `opencode`. Each one is an adapter behind the runner port, chosen by the name in the Line.

---

## 🌐 Context & Problem Statement

- All five ship in v2.0 (`apps/factory/docs/PLAN.md` §8, decision 6). They match the adapters in `apps/cell/src/adapters/runners/` today.
- The Line names the runner for a station. A runner the Cell does not have is a `line_unavailable` case, not a crash (`apps/factory-server/docs/PLAN.md` §3.2).
- The old adapters live in `apps/cell`. The new package must not import from it (boundary, cli-11 rule). The logic is ported, not imported.
- Herdr panes are not part of v2.0 headless runs. Pane runners are planned separately (`apps/factory/docs/PLAN.md` §9).

---

## 📦 Specification / Scope

- **Target**: `apps/factory/src/adapters/runners/`.
- **Classification**: `Integration`.
- **Source to port** (read, do not import):
  - `apps/cell/src/adapters/runners/runner.ts` (interface)
  - `apps/cell/src/adapters/runners/registry.ts` (names)
  - `apps/cell/src/adapters/runners/claude.ts`, `codex.ts`, `cursor.ts`, `antigravity.ts`, `opencode.ts`
  - `apps/cell/src/runners/headless.ts` (process handling)
- **Files to create**:
  - `src/adapters/runners/runner.ts` (the interface, same fields as the old one)
  - `src/adapters/runners/headless.ts` (spawn, stdout capture, abort with SIGTERM then SIGKILL after 5 s)
  - `src/adapters/runners/claude.ts`, `codex.ts`, `cursor.ts`, `antigravity.ts`, `opencode.ts` (one file each, command building only)
  - `src/adapters/runners/registry.ts` (`RUNNER_NAMES`, `getRunner(name)`)
  - `test/unit/adapters/runners/*.test.ts` (command line per runner)
- **Dependencies**: none added.

---

## 🛠️ Implementation Plan

1. **Interface** (`runner.ts`): `name`, `buildCommand(spec)`, `checkInstalled()`. `spec` contains the worktree path, the prompt file, the env, and the model or tier if the Line gives one.
2. **Headless process** (`headless.ts`): spawns with `cwd` set to the worktree, merges `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN` into the env, captures stdout and stderr to `.cell/<step-id>/step.log`. Abort: SIGTERM, then SIGKILL after 5 s.
3. **Each runner file**: only `buildCommand` and `checkInstalled` (for example, `which claude`). No shared state between runners.
4. **Registry**: the list of names is the value sent in `hello.runners`. `getRunner` returns `undefined` for an unknown name, and the caller sends `line_unavailable`.
5. **No runner talks to the server.** The agent talks only to its operator endpoint.

---

## ✅ Acceptance Criteria

- [ ] `RUNNER_NAMES` is exactly `claude, codex, cursor, antigravity, opencode`.
- [ ] Each runner's `buildCommand` output is covered by a unit test with a fixed spec.
- [ ] `checkInstalled` false for a runner -> the Cell reports `line_unavailable` for that Line (test through cli-08 loop).
- [ ] Abort sends SIGTERM first, then SIGKILL after 5 s (fake clock).
- [ ] The step log is written under `.cell/<step-id>/step.log`.
- [ ] No file in `apps/factory/src` imports from `apps/cell` (boundary test).
- [ ] No barrel file; no `any`.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md): unit test output for the five runners.
