---
status: todo
priority: low
line: feature
factory: v2
plan: factory-demo
---

# factory-demo-01: Scaffold Astro, React, and Tailwind app

## Objective

Create `apps/factory-demo` (`@repo/factory-demo`) workspace app with Astro SSR adapter, React islands, Tailwind CSS, design tokens, and responsive dashboard shell.

## Read first

- `pnpm-workspace.yaml`, `turbo.json`, `package.json`
- `packages/typescript-config/astro.json`, `packages/eslint-config/react.js`
- `.agents/references/frontend-architecture.md`
- `.agents/rules/styling.md`, `.agents/rules/ui.md`, `.agents/rules/coding.md`, `.agents/rules/accessibility.md`

## Deliverables

1. **Workspace & tooling:**
   - Add exact Astro, React, Tailwind CSS, `@astrojs/node`, `@astrojs/react`, `lucide-react`, `msw`, `@testing-library/react`, `jsdom` deps to `pnpm-workspace.yaml` `catalog:` (`catalogMode: strict`, `saveExact: true`).
   - Add `apps/factory-demo/package.json` (`@repo/factory-demo`) with `dev`, `build`, `check-types`, `lint`, `test` scripts.
   - Configure `astro.config.mjs` (`output: 'server'`, `@astrojs/node` standalone adapter, React + Tailwind integrations), `tsconfig.json` (extends `@repo/typescript-config/astro.json`), `eslint.config.mjs` (extends `@repo/eslint-config/react`), `vitest.config.ts`.
2. **Theme & layout:**
   - Single theme file `src/styles/theme.css` with Tailwind `@theme` design tokens (colors, spacing, fonts, z-index, breakpoints `320, 480, 640, 768, 1024, 1280, 1440, 1920`), light/dark mode tokens, zero raw `px` or direct literal colors/spacing in components.
   - Base structure matching `.agents/references/frontend-architecture.md` (`src/core/`, `src/libs/`, `src/modules/`, `src/pages/`, `src/shared/`).
   - App shell layout (`src/pages/index.astro` + `src/core/AppShell.tsx`) with accessible landmark regions, skip link, keyboard-navigable sidebar/nav tabs (`Board`, `Plans`, `Cells`, `Projects`, `Admin`), centered main content (`ui-dashboard-centered`), `lucide-react` icons, and `/api/health` Astro endpoint returning `{ ok: true }` validated with `zod`.
3. **Tests & ADR:**
   - Smoke test for `/api/health` and `AppShell` render/navigation (AAA, black-box).
   - One `decisions/` ADR entry.

## Scope guardrails

- Do not implement `factory-server` API proxies or domain views yet (WO 2–5).
- Do not modify `apps/server` or `packages/factory-*`.

## Acceptance criteria

- [ ] `pnpm --filter @repo/factory-demo build` outputs `.astro/` cleanly.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test`, and `pnpm format:check` pass.
