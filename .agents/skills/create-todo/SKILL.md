---
name: create-todo
description: "Generates structured, actionable, and token-lean todos/<name>.md task specification files for monorepo packages, modules, features, or architectural problems. ONLY activate when explicitly requested by the user (e.g., 'use create-todo skill', 'run create-todo', 'create a todo spec file for...'). Never activate automatically."
---

# Create Todo Specification Skill

## 🎯 Activation (Explicit Only)

**Never activate this skill automatically.**

Only activate this skill when the user **explicitly** requests creating a `todos/<name>.md` specification or explicitly asks to use this skill, such as:

- _"Use the create-todo skill to spec..."_
- _"Run create-todo for..."_
- _"Generate a todo spec file in todos for..."_
- _"Create a todos/<name>.md problem spec"_

Do **NOT** activate this skill automatically during standard feature implementation, general task planning, answering questions about code, or everyday agent interactions unless explicitly commanded by the user.

---

## 🏛️ Core Philosophy

A `todos/<name>.md` file is not just a bullet point — it is an **executable technical contract**. It must provide sufficient architectural clarity, dependency contracts, and acceptance criteria that any engineer or AI agent can pick it up and implement it from start to finish without asking clarification questions.

### Key Tenets

1. **Single Responsibility**: One markdown file per logical package, module, or distinct problem (e.g. `todos/astro-config.md`, `todos/booking-management.md`).
2. **Context-Rich, Zero Ambiguity**: Explain the _why_ alongside the _what_. State the architectural layer (Universal, Web UI, Domain Core, Integration).
3. **Exact Dependency Alignments**: Reference explicit packages from `pnpm-workspace.yaml` `catalog:` or `workspace:*`.
4. **Token-Lean Verification**: Avoid multi-step command churn. Use the unified CI verification gate (`pnpm ci:verify`) as the single deterministic verification step.

---

## 📁 File Naming & Directory Convention

- **Directory**: Always output files to `todos/` in the repository root.
- **File Name**: Strictly kebab-case reflecting the package or feature name:
  - `@repo/astro-config` $\rightarrow$ `todos/astro-config.md`
  - `@repo/uih` $\rightarrow$ `todos/uih.md`
  - `booking-checkout` $\rightarrow$ `todos/booking-checkout.md`

---

## 🪜 Execution Pipeline

When explicitly invoked by the user:

1. **Targeted Discovery (Zero Token Waste)**:
   - Inspect **only** the target package's `package.json` and its direct dependencies.
   - Do **NOT** perform exhaustive monorepo scans, broad directory walks, or dump unrelated catalog packages.
   - Read relevant ADRs in `decisions/` only if the task directly alters architectural contracts.
2. **Scoping**:
   - Split complex epics into discrete, high-cohesion `todos/<name>.md` files.
   - Do not bundle unrelated concerns (e.g. keep `@repo/uih` and `@repo/ui` in separate files).
3. **Drafting from Template**:
   - Use the canonical template structure from `.agents/templates/todo.md`.
   - Populate sections: **Objective**, **Context & Problem Statement**, **Specification / Scope**, **Implementation Plan**, and **Acceptance Criteria**.
4. **Agent Override (only when the user names a runner, tier or model)**:
   - Set `runner` and/or `tier` (`advanced` hard / cross-package, `default`, `light` trivial edits). Never write a model id, tasks have no `model` key.
   - User names a model → find its runner and tier in `packages/factory/src/config/models.json` (same as `pnpm factory models`). Not there → say so, do not invent one.
5. **Lean Validation**:
   - Verify markdown formatting and ensure all acceptance criteria are actionable checkboxes (`- [ ]`).
   - Do **NOT** run test or build commands during todo creation — drafting specs does not execute code.

---

## 📝 Required Document Structure

Every generated file in `todos/` must adhere to this markdown structure:

```markdown
---
status: todo
priority: medium # high | medium | low
depends_on: [] # ids (file names without .md) that must be done first
# optional per-role agent override, defaults in packages/factory/src/config/models.json, keys execute and review:
# execute: { runner: claude, tier: light } # runner: cursor | antigravity | claude | codex | opencode, tier: advanced | default | light
# review: { runner: cursor, tier: default }
---

# Todo: [Scope / Package / Feature Name]

## 🎯 Objective

[Crisp, 1-2 sentence statement defining what needs to be built, fixed, or refactored.]

---

## 🌐 Context & Problem Statement

[Explain why this task is needed, how it fits into the monorepo architecture, and what issues occur if this problem is not solved.]

---

## 📦 Specification / Scope

- **Target**: `[e.g. packages/<name> or apps/<name>/src/modules/<module>]`
- **Classification**: `[Universal Tooling | Web UI | Domain Core | Integration | Infrastructure]`
- **Dependencies**:
  - `[package-a: catalog:]`
  - `[package-b: workspace:*]`

---

## 🛠️ Implementation Plan

1. **Initialize File Structure**:
   - List key files to create or modify.
2. **Core Logic & APIs**:
   - List technical contracts, state structures, or APIs.
3. **Integration & Exports**:
   - Define export boundaries and consuming apps.

---

## ✅ Acceptance Criteria

- [ ] Explicit functional verification.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
```

---

## ⚠️ Narrowing & Guardrails

- **Explicit Invocations Only**: Only run when explicitly requested by name or direct command.
- **No Premature Full Implementation**: The todo file defines the plan and contracts, not dumps of untracked code.
- **No Token-Wasting Multi-Command Checks**: Do not instruct subagents to run fragmented checks (`pnpm lint`, `pnpm test`, `pnpm check-types`, `pnpm format:check` individually). Point to `pnpm ci:verify`.
- **Targeted Discovery Only**: Keep tool calls under 3 reads total during todo creation. Do not read unrelated workspace files.
- **Catalog Consistency**: Check `pnpm-workspace.yaml` `catalog:` for pinned versions before guessing dependencies.
