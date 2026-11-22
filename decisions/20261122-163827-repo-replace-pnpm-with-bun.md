---
scope: repo
summary: Switch package manager from pnpm to bun
why: One package manager and script runner; bun 1.4.4 pinned; pnpm supply-chain settings have no bun equivalent
date: 2026-11-22
tags: [tooling, bun, pnpm, ci]
---

- Root `package.json` pins `packageManager` `bun@1.4.4`; `.mise.toml` pins `bun = "1.4.4"` and drops pnpm.
- Catalog moved from `pnpm-workspace.yaml` into root `package.json` `workspaces.catalog` (same 35 pins); `apps/*` and `packages/*` keep `catalog:` and `workspace:*`, no package manifest changed.
- `pnpm-lock.yaml` replaced by `bun.lock`; bun migrated it from the pnpm lock, every npm `name@version` matches. pnpm's own `pnpm@12.15.0` entries are gone.
- `trustedDependencies: ["esbuild"]` replaces pnpm `allowBuilds: esbuild`.
- Dropped pnpm settings with no bun equivalent:
  - `pmOnFail`, `trustPolicy: no-downgrade`, `trustPolicyExclude: semver@6.3.1`
  - `engineStrict`, `catalogMode: strict`, `linkWorkspacePackages: false`
  - `saveExact`: not mapped to bunfig, not verified
  - Owner can ask for an equivalent CI check.
- Script names kept; inner commands use `bun` / `bun run`. `bun run` used for bins (husky, turbo, nitpick, astro).
- `pnpm deploy` replaced by `scripts/deploy-web-deps.mjs`:
  - Resolves web-demo runtime deps and copies workspace sources into `apps/web-demo/dist/sf-deps/node_modules`.
  - Runs `bun install` there, seeded with root `bun.lock`.
  - npm versions match the old `pnpm deploy` output, except pnpm-only peer auto-installs `esbuild`, `tsx`, `has-flag`, `supports-color`.
- `scripts/prepare.mjs` uses `bun run husky` and `bun run turbo`; husky hooks use `bun run`.
- `pr-ci.yml` and `release.yml`: pnpm setup and pnpm cache removed, `oven-sh/setup-bun` pinned to `bun-version: 1.4.4`, `bun install --frozen-lockfile`.
- `sf init` CI template runs `bun install --frozen-lockfile` and `bun run --if-present` steps.
- Install scripts and docs say `bun run build:sf` / `bun run install:sf`.
- `scripts/lint-todos.ts` treats a missing `todos/` folder as no todos. `todos/` was deleted in `d677073`, which made `//#todo:lint` fail `ci:verify` on `main` too; `lint-todos.test.ts` covers the case.
- Workflows not run here; unverified until PR CI.
