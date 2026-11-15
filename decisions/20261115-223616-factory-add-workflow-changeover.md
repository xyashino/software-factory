---
scope: factory
summary: Rename workspace.setup to declarative per-Line changeover
why: Lines own the changeover, so the Cell and runtime hardcode no tool or file
date: 2026-11-15
tags: [definitions, cell, workspace, changeover, events, upcast, perf]
---

- `workspace.setup` becomes `workspace.changeover` (`timeout`, `exec`, optional `keyFiles`) in `lines/*.yml`. A Line without it runs none.
  - A station (`operator` or `inspection`) and `deliver` take `changeover: false` to opt out, or a block that replaces the Line's.
  - Shipped lines: `plan`, `plan-review` and `deliver` opt out. `pnpm install` keys on `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `**/package.json`.
- `keyFiles` are repo-relative paths or globs. Globs support `*`, `**` and `?` only, with no new dependency.
  - The Cell hashes their git blobs at the base commit, read from `git ls-tree` on the commit, not the dirty worktree.
  - A literal file the commit lacks hashes as absent, so adding it changes the key.
  - Without `keyFiles`, the marker stays per commit (`.cell/cache-<commit>`).
- `buildJob` resolves the changeover from the pinned snapshot: the station's or deliver's own block, else the Line's. Cell runs `job.workspace.changeover` as given, and names no tool, file, or station.
- Order events move from schema version 2 to 3. The upcaster renames the `workspace_failed` stage `setup` to `changeover`, and upcasts a pinned version 1 snapshot in `order_created` and `spec_updated`. Stored rows are never rewritten.
- Plan events stay at schema version 2: they have no workspace stage. The store writes `PLAN_SCHEMA_VERSION` for plan rows, so one counter no longer covers both streams.
- Line snapshot version 2 carries `changeover` and `keyFiles`. A version 1 snapshot upcasts in memory, and its stored hash is kept, since it names bytes already stored.
- Upgrade: the first job on an existing worktree runs its changeover once more, because the marker names differ for keyed jobs.
