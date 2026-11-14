---
status: todo
priority: low
workflow: standard
factory: v2
---

# v2-trial-smoke: smoke test for the v2 factory

## Objective

Prove that the v2 factory picks a todo, runs its Stations, delivers a PR and
reports the result. Non-critical, no production code.

## Scope

- Add the file `docs/TRIAL-SMOKE.md` with one heading and one sentence:
  `# Trial smoke` and `The v2 factory delivered this todo.`
- Change nothing else.

## Acceptance criteria

- [ ] `docs/TRIAL-SMOKE.md` exists with the heading and sentence above.
- [ ] `pnpm format:check` passes.
