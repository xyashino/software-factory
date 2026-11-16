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
   - `[path/to/file1.ts]`
   - `[path/to/file2.ts]`
2. **Core Logic & Behavior**:
   - [Detailed technical steps, contracts, APIs, or data flows]
3. **Exports & Integration**:
   - [How other modules or apps consume this code]

---

## ✅ Acceptance Criteria

- [ ] [Explicit functional criterion 1]
- [ ] [Explicit functional criterion 2]
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
