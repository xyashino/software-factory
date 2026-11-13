---
scope: factory
summary: Build v2 beside frozen v1; add hono and fast-check
why: v2 design lives in docs/; boundaries must be lint-enforced from day one; hono and fast-check join the catalog
date: 2026-11-13
tags: [v2, architecture, dependencies, factory]
---

- Layout: `apps/{server,cell,cli,operator-cli}` and `packages/{factory-core,factory-db,factory-definitions}`; v1 `packages/software-factory` is not edited
- Design source: `docs/README.md` (map), `docs/STRUCTURE.md` (layout, dependency rules), `docs/RULES.md` (hard rules), `docs/ROADMAP.md` (M0 to M10)
- Dependency rules are enforced twice: `package.json` lists only the allowed workspace deps (pnpm strict resolution), and `no-restricted-imports` in each `eslint.config.mjs` bans forbidden paths
- `factory-core` purity test scans sources for `Date.now`, `Math.random`, `process.`, `fetch(`, `crypto`
- M0 holds no domain code: every package is a stub with a smoke test
- Catalog: `hono` 4.13.14 for `apps/server` only (Factory HTTP); published 2026-10-25, past the two-week age rule
- Catalog: `fast-check` 4.10.2, dev-only in `factory-core` for the M1 property tests; published 2026-09-19
