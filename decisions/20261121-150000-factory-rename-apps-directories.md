---
scope: factory
summary: Rename apps dirs and packages to sf, factory, cell, web-demo
why: apps/factory held the sf CLI while apps/factory-server held the server; names hid roles
date: 2026-11-21
tags: [rename, monorepo]
---

- `apps/factory` -> `apps/sf` (`@repo/sf`); `apps/factory-server` -> `apps/factory` (`@repo/factory`); `apps/cell-server` -> `apps/cell` (`@repo/cell`); `apps/factory-web-demo` -> `apps/web-demo` (`@repo/web-demo`).
- `factory` moved to `sf` first to avoid path collision.
- Runtime names kept: `sf cell server`, `__cell-server`, `factory.db`, `cell-server.log`, HTTP paths, systemd unit names.
- Cell eslint `LEGACY` list drops `@repo/cell` so the new package name stays importable.
- Operator boundary test forbids imports of the new app dirs and `@repo/{factory,sf,cell,web-demo}`.
- Build paths, install script, README, app docs and skills point at the new dirs.
