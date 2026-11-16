---
status: todo
priority: low
depends_on: []
line: fast
type: chore
---

# Todo: Clean up comments in production code

## 🎯 Objective

Remove comments that break the comment rules, without changing any code behaviour: spec references, ADR links, v1/v2 provenance, JSDoc that restates the types, and comments that describe what the code already says.

---

## 🌐 Context & Problem Statement

Production code has about 2,250 comment lines across `packages/` and `apps/` (non-test `.ts`). Many are long JSDoc blocks on every export. About 576 lines in 267 files cite spec sections (`CORE §12.2`, `PROTOCOL §3.1`), and others say "ported from v1" or "as v1 did". These go stale when the docs move, and they point at a v1 package that no longer exists (see `todos/remove-v1-and-v2-naming.md`).

The existing rule `coding-minimal-comments` already says: only the non-obvious why, no task references. The code does not follow it. This todo cleans up the existing comments only. It does not change the rule itself; tightening the rule is a separate change.

---

## 📦 Specification / Scope

- **Target**: production `.ts` and `.tsx` files under `packages/*/src` and `apps/*/src`. Exclude `__tests__` and `testing/` fixtures.
- **Classification**: `Repository hygiene`
- **Dependencies**: none. Touches many files, so it can conflict with open work. Run it after `todos/mechanic-own-tab.md` and `todos/move-log-blobs-to-files.md` land, or rebase them.

Rules for each comment:

1. **Spec references**: remove `§` section numbers and `CORE`, `PROTOCOL`, `STORAGE`, `ROADMAP`, `STRUCTURE`, `OPEN-QUESTIONS` links. If the sentence still makes sense without the reference, keep the sentence. Otherwise delete the comment.
2. **ADR links**: remove any `decisions/...` path from comments.
3. **Provenance**: remove "v1", "ported from", "as v1 did" and similar. Keep only the behaviour the comment explains, rewritten without the history.
4. **JSDoc**: keep a JSDoc block only on an exported function, type or constant whose contract is not clear from its types. Remove JSDoc on internal helpers and on exports whose name and signature already say what they do.
5. **Non-obvious constraints**: keep at most one short comment (one or two lines) for each non-obvious constraint, invariant or workaround. Delete comments that restate the next line.
6. **Commented-out code and TODO-style task notes** get removed unless they name a real open defect.

Do not change any code, names, types, or string literals. A comment that is the only record of a constraint is rewritten into a short constraint comment, not deleted.

---

## 🛠️ Implementation Plan

1. **Count baseline**: count comment lines per package, and the `§`, `decisions/` and `v1`/`v2` hits, so the result can be compared.
2. **Clean per package**, one package per commit, in dependency order: `factory-core`, `factory-definitions`, `factory-db`, `factory-runtime`, then `apps/cli`, `apps/cell`, `apps/server`, `apps/operator-cli`.
3. **Check no code changed**: `git diff` must show only comment lines removed or rewritten. Use `git diff -w --ignore-comments`-style review, or review each file's diff by eye.
4. **Verify**: run `pnpm ci:verify` once at the end.

---

## ✅ Acceptance Criteria

- [ ] No `§` section references remain in production `.ts` and `.tsx` comments.
- [ ] No `decisions/` path appears in production comments.
- [ ] No "v1", "v2", "ported from" or "as v1 did" provenance remains in production comments.
- [ ] Every JSDoc block left is on an exported item whose contract is not clear from its types.
- [ ] No comment restates the line below it.
- [ ] The diff changes no code, only comments.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Exactly one new `decisions/` entry for this change.
