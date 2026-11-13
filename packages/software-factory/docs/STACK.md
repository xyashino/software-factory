# Tech Stack 🛠️

Minimal stack for **SoftwareFactory**: Bun, citty, zod, yaml, picocolors and Drizzle over `bun:sqlite`.

## Overview

| Layer                | Technology               | Purpose                                                                                   |
| :------------------- | :----------------------- | :---------------------------------------------------------------------------------------- |
| **Runtime**          | **Bun**                  | Fast startup for the in-pane CLI, built-in SQLite, `Bun.spawn` for gates and Herdr calls. |
| **CLI Framework**    | **citty**                | Typed arguments, lazy subcommand loading.                                                 |
| **State**            | **bun:sqlite** + **Drizzle ORM** | Embedded SQLite in WAL mode. `drizzle-orm` query builders behind a `StorePort`.   |
| **Validation**       | **zod** + **yaml**       | Strict parsing of `roles/*.md` frontmatter and `workflows/*.yml`.                         |
| **Process**          | **Bun.spawn**            | Quality gate commands, `herdr`, `git`, `gh`.                                              |
| **Terminal Styling** | **picocolors**           | Colors for the board, log and supervisor output.                                          |
| **ANSI Cleaning**    | `node:util`              | `stripVTControlCharacters` cleans gate logs before they reach an agent. No dependency.    |
| **Tests**            | **vitest** (`bun --bun`) | Same runner as the rest of the monorepo.                                                  |

There is no LLM client in the harness. Every model call happens inside a runner started through Herdr.

---

## Dependencies (`package.json`)

Five production dependencies, versions from the workspace catalog (`pnpm-workspace.yaml`):

```json
{
  "name": "@repo/software-factory",
  "type": "module",
  "private": true,
  "dependencies": {
    "citty": "catalog:",
    "drizzle-orm": "catalog:",
    "picocolors": "catalog:",
    "yaml": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/bun": "catalog:",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

---

## Key Technical Decisions

1. **Drizzle ORM over `bun:sqlite`.** `SqliteStore` builds `drizzle(db, { schema })` on the `bun:sqlite` handle; tables are declared in `src/adapters/store/schema.ts` and queried with typed builders behind the `StorePort`. Drizzle is only the query layer: schema changes stay numbered SQL files in `migrations/`, applied on startup (`0001_init.sql` is the source of truth). See `decisions/20261111-120051-factory-replace-sqlite-raw-sql-drizzle.md`.
2. **SQLite in WAL mode with `busy_timeout`.** The supervisor and the in-pane `factory` CLI write to the same file. WAL lets readers run alongside the single writer; `PRAGMA busy_timeout = 5000` makes a second writer wait instead of failing with `database is locked`.
3. **Herdr through its CLI.** The adapter runs `herdr ...` with `Bun.spawn` behind a `HerdrPort`. The CLI is Herdr's documented surface; a direct socket client is deferred until spawning is a measured cost.
4. **`factory` on the pane's PATH.** Agents call `software-factory` from inside their pane. The supervisor passes `--env PATH=<binDir>:<current PATH>` when it creates the tab, where `<binDir>` holds a `software-factory` launcher. In development the launcher runs `bun src/cli.ts`; `bun build --compile` can produce a single file later, but it is an optimization, not a requirement (the harness needs `herdr`, `git`, `gh` and `pnpm` on the machine either way).
5. **Lazy subcommands.** `citty` imports only the handler for the command called, so `software-factory done` inside a pane does not load workflow parsers or git code.
6. **Roles and workflows are read from disk.** They live in the package's `roles/` and `workflows/` directories and are never bundled, so editing a file changes the line without a rebuild.
