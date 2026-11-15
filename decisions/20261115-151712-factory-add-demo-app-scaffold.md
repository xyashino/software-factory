---
scope: factory
summary: Scaffold factory-demo app: Astro SSR, React islands, Tailwind
why: Dashboard shell needs SSR Astro, React islands and theme tokens before factory-server domain views (WO 2-5)
date: 2026-11-15
tags: [factory-demo, astro, react, tailwind, scaffold]
---

- New workspace app `apps/factory-demo` (`@repo/factory-demo`), private ESM, scripts `dev`, `build`, `check-types`, `lint`, `test`.
- Astro `output: 'server'` with `@astrojs/node` standalone adapter and `@astrojs/react` islands; Tailwind v4 wired through the `@tailwindcss/vite` plugin, not an Astro integration.
- Versions are exact pins in the `pnpm-workspace.yaml` catalog, all at least two weeks old at pin time.
- `oxc-transform-react`, `react-dom`, `@types/react(-dom)`, `@testing-library/dom` added as peers the catalog packages require.
- Single theme file `src/styles/theme.css`: `@theme` tokens for colors, spacing, fonts, z-index, containers and breakpoints `320-1920`; light tokens on `:root`, dark under `prefers-color-scheme` and `data-theme="dark"`.
- `src/core/AppShell.tsx`: skip link, `header`, `nav aria-label="Primary"` with six `lucide-react` tabs (Board, Plans, Intake, Cells, Projects, Admin), arrow/Home/End focus movement, `aria-current` on the active tab, `main#main` in `ui-dashboard-centered`.
- `src/pages/index.astro` mounts `AppShell` with `client:load`; `src/pages/api/health.ts` returns `{ ok: true }` validated by zod.
- Tests in `src/__tests__/` (AAA, black-box): `/api/health` response and `AppShell` landmarks, tab list, arrow focus, section selection.
- `.astro/` added to `.gitignore` and `.prettierignore` (generated output).
- No changes to `apps/server` or `packages/factory-*`; factory-server proxies and domain views are not included.
