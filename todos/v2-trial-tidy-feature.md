---
status: todo
priority: low
workflow: feature
factory: v2
---

# v2-trial-tidy-feature: remove redundant comments from one file

## Objective

Real-AI trial of the v2 factory on the feature Line: remove redundant comments from one source file, change no code.

## Scope

- Only `packages/factory-runtime/src/intake.ts`.
- Remove a comment only if it restates the code next to it, or is commented-out code.
- Keep every comment that cites a spec section (`CORE §…`, `PROTOCOL §…`) or explains why the code is the way it is, including comments that state a behaviour the code relies on.
- Do not change any code, imports, names or formatting outside the removed comment lines.

## Acceptance criteria

- [ ] Only `packages/factory-runtime/src/intake.ts` changed, and only comment lines were removed.
- [ ] Every comment that cites a spec section is still there.
- [ ] `pnpm --filter @repo/factory-runtime check-types`, `lint` and `test` pass.
