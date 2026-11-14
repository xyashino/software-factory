---
scope: repo
summary: Pin @eslint/js 9.39.5 and typescript 6.0.3 for lint compatibility
why: Dependabot bumps 3 and 9 broke eslint across the workspace
date: 2026-11-14
tags: [deps, typescript, eslint]
---

- Revert `typescript` (`7.0.2` -> `6.0.3`, PR 3) because `typescript-eslint@8.72.2` throws on TypeScript 7.0
- Revert `@eslint/js` (`10.0.1` -> `9.39.5`, PR 9) because its `no-useless-assignment` rule fails `--max-warnings 0` in `packages/software-factory/src/supervisor/execute.ts`
- Refresh `pnpm-lock.yaml` cleanly against `pnpm-workspace.yaml`
