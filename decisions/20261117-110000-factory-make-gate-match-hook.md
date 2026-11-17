---
scope: factory
summary: Make every quality gate a dry run of the commit hook
why: The gate ran different checks than the commit hook, so a passing gate still failed at delivery.
date: 2026-11-17
tags: [factory, lines, gate, delivery, husky]
---

- Every line's `quality-gate` runs `pnpm ci:verify` and `pnpm nitpick:check`. `ci:verify` is the exact list the husky pre-commit hook runs, so a gate pass means the hook passes.
- Delivery commits with `--no-verify`. The gate has already run the hook's checks on the tree being committed, so the hook would run the whole suite a second time.
- Human commits still run the hook. The line hashes pinned in `line-snapshot.test.ts` follow the new gate commands.
