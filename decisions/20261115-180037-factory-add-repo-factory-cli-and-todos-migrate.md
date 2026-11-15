---
scope: factory
summary: Repo .factory CLI, order and plan create, todos migrate
why: Server stays a pure store; the CLI reads repo definitions and migrates todos/ once
date: 2026-11-15
tags: [cli, factory-definitions, todos, migration, cell, config]
---

- `factory init [--dir] [--force]` scaffolds `<repo>/.factory/` from `packages/factory-definitions/starter/.factory/`.
  - An existing `.factory/` is refused unless `--force`, which overwrites only the starter files.
- `factory check [--dir]` validates `<repo>/.factory/` and cross-checks `.nitpick/` when present; defaults to the working directory.
- `factory order create` reads `--line` from `<repo>/.factory/lines/`, builds its `LineSnapshot` in the CLI, and sends `createOrder`.
  - The spec comes from `--file`, `--body`, or stdin (`-`). The server never reads a repo definition.
- `factory order pr-state <id> <state> --pr-url <url>` is the hand fallback. The server refuses an order that has no PR yet.
- `factory plan create --members <files…>` builds a chain in the order given.
  - A member may depend only on the member before it. Done or cancelled members are refused.
  - Member orders are checked against `board` before any write: the server writes the plan first, so a refused member would leave an empty plan.
- Todo model: optional frontmatter `type` (default `feat`); `title` is the H1 without its `<todoId>:` prefix.
- `factory todos migrate --project <id> [--dry-run] [--all] [--remove]`:
  - Files whose OrderId the server has are skipped before the scan, so they never get `reused_id`. Plans the server has are skipped with their files.
  - Plans go first, then standalone orders in dependency order. Commands use deterministic `commandId`s (`migrate:<hash>`).
  - A dependency is satisfied when its file is `done` or gone; any other unmigrated dependency blocks the todo.
  - `--remove` deletes a file only when the server has its work. A dry run never deletes.
- Cell: `<repo>/.factory/cell.toml` overrides `~/.config/factory-cell/config.toml` key by key; `projects` is replaced, not merged. `--repo-dir` names the repo.
