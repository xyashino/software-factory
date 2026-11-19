---
status: queued
priority: high
line: feature
type: feat
factory: v2
---

# add-root-readme-v2: Write the root README.md for the current repo

Create or rewrite the root `README.md` so it describes the repo as it is now.

- What the repo is: a pnpm + turbo monorepo for the software factory (todos become PRs through Lines run by Cells).
- Layout: `apps/` (factory, factory-server, factory-web-demo, operator, operator-cli, cell, cli, server, worker), `packages/` (factory-core, factory-db, factory-definitions, factory-runtime, operator-protocol, nitpick, ...), `.factory/` (repo config, lines, operators, templates), `.nitpick/` (rules and skills), `docs/`, `decisions/`, `todos/`.
- Commands: `pnpm install`, `pnpm test`, `pnpm lint`, `pnpm check-types`, `pnpm format:check`, `pnpm ci:verify`, `pnpm nitpick:sync`, `pnpm nitpick:check`.
- Run locally: `pnpm factory-server` (or `factory server start`), `factory cell start`, `factory todos import`, `factory queue`. Link `apps/factory-server/docs/LOCAL-RUN.md`.
- Link the design docs: `docs/README.md`, `apps/factory/docs/PLAN.md`, `apps/factory-server/docs/PLAN.md`.

Keep it short. Only facts that exist in the repo today. No marketing text. Drop the stale table that lists `apps/cli` and `apps/server` as the main entry points.
