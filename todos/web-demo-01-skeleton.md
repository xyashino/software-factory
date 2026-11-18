---
status: todo
factory: v2
plan: web-demo
priority: medium
line: feature
type: feat
---

# Todo: `web-demo-01-skeleton` — Astro SSR Package

## 🎯 Objective

Create `apps/factory-web-demo` as a buildable Astro SSR app with the Node adapter, the env config, and one placeholder page. No factory-server calls yet.

---

## 🌐 Context & Problem Statement

- `apps/factory-web-demo/` is empty and untracked. See [PLAN](../apps/factory-web-demo/docs/PLAN.md) §4 and §5.
- Every later task imports from `src/lib/config.ts`, so its shape is fixed first.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-web-demo/` (`@repo/factory-web-demo`, `private: true`, `type: module`).
- **Classification**: `Web UI` (layout), `Domain Core` (config parsing).
- **Dependencies**: `astro`, `@astrojs/node` (add both to `pnpm-workspace.yaml` `catalog:` first; versions from PLAN §5), `zod: catalog:`; devDependencies `@types/node`, `typescript`, `vitest`, `eslint`, `@repo/eslint-config`, `@repo/typescript-config` (catalog or workspace).

---

## 🛠️ Implementation Plan

1. `package.json` scripts: `dev`, `build`, `start` (`node dist/server/entry.mjs`), `check-types` (`astro check && tsc --noEmit`), `lint` (`eslint src test --max-warnings 0`), `test` (`vitest run`).
2. `astro.config.mjs`: `output: 'server'`, `adapter: node({ mode: 'standalone' })`, no integrations.
3. `tsconfig.json` extends `@repo/typescript-config`; `eslint.config.mjs` and `vitest.config.ts` copied from `apps/factory-server` without server-only rules.
4. `src/lib/config.ts`: `loadConfig(env)` reads `FACTORY_URL` (default `http://127.0.0.1:7070`), `FACTORY_PROJECT_ID` (required), `FACTORY_DATA_DIR` (optional), `FACTORY_TOKEN` (optional here; enforced in task 05), `HOST` (default `127.0.0.1`), `PORT` (default `4321`). Zod-validated. Throws a message naming the missing variable.
5. `src/layouts/Base.astro`: nav with placeholder links, one `<style>` block.
6. `src/pages/index.astro`: text "factory web demo" only.
7. Tests: `test/unit/config.test.ts` covers missing `FACTORY_PROJECT_ID` (throws), defaults for `HOST`/`PORT`/`FACTORY_URL`.

---

## ✅ Acceptance Criteria

- [ ] `pnpm --filter @repo/factory-web-demo build` produces `dist/server/entry.mjs`.
- [ ] `FACTORY_PROJECT_ID=x pnpm --filter @repo/factory-web-demo start` serves `/` with `200` on `127.0.0.1:4321`.
- [ ] Server listens on `127.0.0.1` by default.
- [ ] Missing `FACTORY_PROJECT_ID` fails at startup and names the variable.
- [ ] `astro build` emits no client `<script>` for `/`.
- [ ] No barrel `index.ts`; no `any`; no `unknown` used as a type; arrow functions only.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence per [evidence](.agents/skills/evidence/SKILL.md): `curl -i http://127.0.0.1:4321/` output.
