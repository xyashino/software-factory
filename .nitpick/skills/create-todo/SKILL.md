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

1. **Single Responsibility**: One markdown file per logical package, module, or distinct problem (e.g. `todos/cell-config-json.md`, `todos/todos-import-export.md`).
2. **Context-Rich, Zero Ambiguity**: Explain the _why_ alongside the _what_. State the architectural layer (Universal, Web UI, Domain Core, Integration).
3. **Exact Dependency Alignments**: Reference explicit packages from `pnpm-workspace.yaml` `catalog:` or `workspace:*`.
4. **Token-Lean Verification**: Avoid multi-step command churn. Use the unified CI verification gate (`pnpm ci:verify`) as the single deterministic verification step.

---

## 📁 File Naming & Directory Convention

- **Directory**: Always output files to `todos/` in the repository root.
- **File Name**: Strictly kebab-case reflecting the package or feature name. The file name without `.md` is the todo id, used in `depends_on`:
  - `apps/cell` $\rightarrow$ `todos/cell-config-json.md`
  - `packages/factory-definitions` $\rightarrow$ `todos/todos-import-export.md`
  - `gate-failure-diagnosis` $\rightarrow$ `todos/gate-failure-diagnosis.md`

---

## 🪜 Execution Pipeline

When explicitly invoked by the user:

1. **Targeted Discovery (Zero Token Waste)**:
   - Inspect **only** the target package's `package.json` and its direct dependencies.
   - Do **NOT** perform exhaustive monorepo scans, broad directory walks, or dump unrelated catalog packages.
   - Read relevant ADRs in `decisions/` only if the task directly alters architectural contracts.
2. **Scoping**:
   - Split complex epics into discrete, high-cohesion `todos/<name>.md` files.
   - Do not bundle unrelated concerns (e.g. keep `apps/cell` and `apps/server` changes in separate files).
3. **Drafting from Template**:
   - Use the canonical template structure from `references/todo.md` (next to this file).
   - Populate sections: **Objective**, **Context & Problem Statement**, **Specification / Scope**, **Implementation Plan**, and **Acceptance Criteria**.
4. **Frontmatter**:
   - Set only keys the parsers read (table below). Never add `execute`, `review`, `runner`, `tier` or `model` keys: tasks do not select them.
   - A `line` the user does not name stays `feature`. A change `type` the user does not name stays `feat`.
5. **Lean Validation**:
   - Verify markdown formatting and ensure all acceptance criteria are actionable checkboxes (`- [ ]`).
   - Do **NOT** run test or build commands during todo creation — drafting specs does not execute code.

---

## 🧾 Frontmatter Keys

Parsed by `packages/factory-definitions/src/todo.ts` (v2 intake) and `packages/software-factory/src/supervisor/pick-todo.ts` (v1, `pnpm sf`).

| Key          | Values                                                                                  | Default   | Used by | Meaning                                                                      |
| ------------ | --------------------------------------------------------------------------------------- | --------- | ------- | ---------------------------------------------------------------------------- |
| `status`     | `todo` \| `done` \| `cancelled`                                                         | required  | v1, v2  | Only `todo` is picked up.                                                    |
| `priority`   | `high` \| `medium` \| `low`                                                             | `medium`  | v1, v2  | Highest first, then by file name.                                            |
| `depends_on` | list of todo ids (file names without `.md`)                                             | `[]`      | v1, v2  | Todos that must be delivered first.                                          |
| `line`       | a Line name: `fast`, `standard`, `feature` (`.factory/lines/<name>.yml`)                | `feature` | v2      | The Line the Work order runs on.                                             |
| `workflow`   | a v1 workflow name                                                                      | `feature` | v1      | Alias of `line` in v2. If both are set they must be equal.                   |
| `type`       | `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `perf`, `build`, `ci`, `style`, `revert` | `feat`    | v2      | Change category: branch `<type>/<id>` and commit type.                       |
| `plan`       | plan slug: `[a-z0-9][a-z0-9-]{0,63}`                                                    | none      | v2      | Groups todos into an Order Plan. In-plan `depends_on` must form a linear chain. |
| `factory`    | `v2`                                                                                    | none      | v1, v2  | Marks the todo for v2 intake. v1 (`pnpm sf`) skips a todo with `factory: v2`. |

Rules of thumb:

- Targeting v2 (`factory-server` + `factory-cell`, `pnpm factory`): set `factory: v2`, `line` and `type`.
- Targeting v1 (`pnpm sf`): set `workflow`, leave out `factory`, `line`, `type` and `plan`.
- The title is the first `# ` heading; a `<todo-id>:` prefix is dropped.

---

## 📝 Required Document Structure

Every generated file in `todos/` must adhere to this markdown structure:

```markdown
---
status: todo
priority: medium # high | medium | low
depends_on: [] # todo ids (file names without .md) that must be done first
factory: v2 # v2 intake. Leave out for v1 (`pnpm sf`)
line: feature # fast | standard | feature (v1: `workflow`)
type: feat # feat | fix | chore | refactor | docs | test | perf | build | ci | style | revert
# plan: my-plan # optional Order Plan slug, in-plan depends_on form a linear chain
---

# Todo: [Scope / Package / Feature Name]

## 🎯 Objective

[Crisp, 1-2 sentence statement defining what needs to be built, fixed, or refactored.]

---

## 🌐 Context & Problem Statement

[Explain why this task is needed, how it fits into the monorepo architecture, and what issues occur if this problem is not solved.]

---

## 📦 Specification / Scope

- **Target**: `[e.g. packages/<name> or apps/<name>/src/<module>]`
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
