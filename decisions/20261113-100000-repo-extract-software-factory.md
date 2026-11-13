---
scope: repo
summary: Extract software-factory into its own monorepo
why: The factory is a standalone tool; omino apps and their tooling are not needed to build or run it
date: 2026-11-13
tags: [repo, factory]
---

- Copied `packages/software-factory`, `nitpick`, `eslint-config`, `typescript-config` from omino `ac35ed8`
- Dropped omino apps, `astro-config`, `tailwind-config`, `vibe-test` and the legacy `packages/factory`
- pnpm catalog trimmed to the dependencies the remaining packages use
- Decision-log scopes now cover `repo`, `factory`, `software-factory`, `nitpick`, the config packages, `docs`, `ci`
