# Structure

## 1. Repository layout

```text
software-factory/
├── pnpm-workspace.yaml            # packages: [apps/*, packages/*]
├── turbo.json
├── docs/                          # this design (v2)
├── decisions/                     # ADRs, shared by v1 and v2
├── todos/                         # the queue v1 executes (it builds v2)
├── deploy/                        # systemd units, Litestream config example (v2)
│
├── apps/
│   ├── server/                    # @repo/factory-server        bin: factory-server   (the Factory)
│   │   └── src/
│   │       ├── main.ts            # config, open db, migrate, boot grace, start HTTP + loops
│   │       ├── admin/             # token create, backup, import, export, rebuild-projections
│   │       ├── http/
│   │       │   ├── app.ts         # Hono app, auth middleware, error mapping (PROTOCOL §3.5)
│   │       │   ├── supervisor.ts  # /v1/board, /v1/orders/*, /v1/stream, /v1/cells, /v1/join-tokens, /v1/admin/*
│   │       │   ├── cell.ts        # /v1/cell/*
│   │       │   └── blobs.ts       # /v1/blobs/*
│   │       ├── handle-command.ts  # load → evolve → decide → nextJob → andon/continuation → append
│   │       ├── claim.ts           # PROTOCOL §5.2
│   │       ├── reaper.ts          # PROTOCOL §5.4
│   │       ├── intake/            # git mirror, todo parsing glue, spec drift, PR state polling
│   │       ├── prompts/           # render CycleContext + Operator profile + templates → blob; runtime prompts
│   │       └── stream.ts          # SSE fan-out from the event feed
│   │
│   ├── cell/                      # @repo/factory-cell          bin: factory-cell     (a Cell)
│   │   └── src/
│   │       ├── main.ts            # config, join, hello, slots, claim loop, heartbeat loop, leave
│   │       ├── factory-client.ts  # typed client of the cell API, retries, idempotency ids
│   │       ├── workspace/         # mirror, worktree, sync/setup cache, LRU eviction
│   │       ├── jobs/
│   │       │   ├── run-operator-station.ts
│   │       │   ├── run-inspection.ts
│   │       │   └── deliver.ts
│   │       ├── cycle/             # runtime loop: observe → core/cycle.watch → act; signals; handover on leave
│   │       ├── operator-socket.ts # unix socket for factory-operator; Cycle tokens
│   │       ├── checkpoint.ts      # PROTOCOL §8.2: commit + trailers + dry run + push --force-with-lease
│   │       └── adapters/          # carried over from v1: herdr, git, github, process, runners/*
│   │
│   ├── cli/                       # @repo/factory-cli           bin: factory          (the Supervisor CLI)
│   │   └── src/
│   │       ├── cli.ts             # citty, lazy subcommands
│   │       ├── client.ts          # typed client of the supervisor API
│   │       ├── render/            # board, Work order, Traveler views (picocolors)
│   │       └── commands/          # status, show, log, answer, resume, reopen, nudge, cancel, prio, sync, cells, check, admin
│   │
│   └── operator-cli/              # @repo/factory-operator-cli  bin: factory-operator (called by Operators)
│       └── src/
│           ├── cli.ts             # citty; no yaml, no git, no db
│           ├── socket-client.ts
│           └── commands/          # done, verdict, ask, tell, block, context
│
└── packages/
    ├── software-factory/          # v1 — frozen, not edited by v2 work
    ├── factory-core/              # @repo/factory-core       (CORE.md)
    ├── factory-db/                # @repo/factory-db         (STORAGE.md)
    │   ├── migrations/
    │   └── src/                   # sqlite event store, blob store, lease store, export/import
    ├── factory-definitions/       # @repo/factory-definitions
    │   ├── operators/             # Operator profiles, copied from v1 roles/, then evolved
    │   ├── lines/                 # Line definitions, copied from v1 workflows/, schema v2
    │   ├── templates/             # prompts, runtime prompts, PR templates
    │   ├── schemas/line.schema.json
    │   └── src/                   # load, validate, todo frontmatter, snapshot + hash
    ├── nitpick/
    ├── eslint-config/
    └── typescript-config/
```

Conventions inherited from the repo and v1: `kebab-case.ts`, arrow functions only, no `index.ts`
barrels (packages expose subpaths through `exports`), tests in `__tests__/` next to the code,
versions from the pnpm catalog.

## 2. Package responsibilities

| Package               | Runtime deps                                                        | Contains                                                                                                   | Must not contain                                                      |
| :-------------------- | :------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| `factory-core`        | `zod`                                                               | Domain, projection fold, contracts, port interfaces, pure Cycle policy, test fakes and harness             | I/O of any kind; hashing; `bun:*`, `node:*` imports                   |
| `factory-definitions` | `zod`, `yaml`, core                                                 | Definition files and their parser; todo frontmatter parsing and `OrderId` derivation; Line snapshot + hash | Runtime state; network                                                |
| `factory-db`          | `drizzle-orm`, core                                                 | Store implementations, migrations, export/import file format                                               | Domain decisions (`decide`, `nextJob`, `toProjection` calls)          |
| `apps/server`         | `hono`, core, db, definitions                                       | HTTP, scheduling loops, intake, prompt rendering, admin commands, projection rebuild                       | Herdr, runners, worktrees, `core/cycle`                               |
| `apps/cell`           | core (adapters use Bun APIs)                                        | Job execution, adapters, Cycle runtime, Operator socket, checkpoints                                       | `factory-db`, `factory-definitions` (everything arrives in the `Job`) |
| `apps/cli`            | `citty`, `picocolors`, core, definitions (for `factory check` only) | Supervisor client and rendering                                                                            | `factory-db`, Cell code                                               |
| `apps/operator-cli`   | `citty`, core (contracts only)                                      | The Operator verbs                                                                                         | Anything else; must start in < 100 ms                                 |

Hashing (blob refs, Line hash) happens only where I/O is allowed: `factory-definitions` for Line
snapshots, the Factory and the Cell for blobs.

## 3. Dependency rules

```mermaid
flowchart BT
  core["factory-core"]
  defs["factory-definitions"] --> core
  db["factory-db"] --> core
  server["apps/server"] --> core
  server --> db
  server --> defs
  cell["apps/cell"] --> core
  cli["apps/cli"] --> core
  cli --> defs
  op["apps/operator-cli"] --> core
```

Allowed imports (row imports column):

|                       |      core      | core/cycle | definitions |  db   | v1  |
| :-------------------- | :------------: | :--------: | :---------: | :---: | :-: |
| `factory-core`        |       ✓        |     ✓      |      ✗      |   ✗   |  ✗  |
| `factory-definitions` |       ✓        |     ✗      |      ✓      |   ✗   |  ✗  |
| `factory-db`          |       ✓        |     ✗      |      ✗      |   ✓   |  ✗  |
| `apps/server`         |       ✓        |   **✗**    |      ✓      |   ✓   |  ✗  |
| `apps/cell`           |       ✓        |     ✓      |    **✗**    | **✗** |  ✗  |
| `apps/cli`            |       ✓        |     ✗      |      ✓      | **✗** |  ✗  |
| `apps/operator-cli`   | contracts only |     ✗      |      ✗      |   ✗   |  ✗  |

## 4. Enforcement

- Each package lists only its allowed workspace dependencies in `package.json`; pnpm strict
  resolution then makes a forbidden import fail to resolve.
- ESLint `no-restricted-imports` per package for subpaths (`@repo/factory-core/cycle/*` in the
  server, `bun:*` / `node:*` in core, `@repo/software-factory` everywhere in v2).
- A purity test in `factory-core` (as v1's `purity.test.ts`) scans sources for `Date.now`,
  `Math.random`, `process.`, `fetch(`, `crypto`.

## 5. Workspace changes (M0)

- `pnpm-workspace.yaml`: add `apps/*`.
- Catalog additions (each with a `decisions/` entry, per the v1 rule on dependencies):
  `hono` (Factory HTTP), `fast-check` (dev, property tests).
  ULIDs are generated by a 20-line helper behind the `Ids` port, no dependency.
- Root `package.json` scripts: `factory`, `factory-server`, `factory-cell` next to the existing `sf`.

## 6. Carried over from v1

v2 **copies** code from v1 and adapts it. It never imports v1. Paths are relative to
`packages/software-factory/`.

| v1 source                                                                                                                   | v2 destination                                    | Treatment                                                                                            |
| :-------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------ | :--------------------------------------------------------------------------------------------------- |
| `src/engine/next-action.ts`                                                                                                 | `core/order/next-job.ts`                          | Same decision-table style; new rows (CORE §6)                                                        |
| `src/engine/reduce.ts`                                                                                                      | `core/order/evolve.ts`                            | Rewrite against the v2 state; keep the liveness guard                                                |
| `src/engine/events.ts`, `state.ts`, `actions.ts`                                                                            | `core/order/events.ts`, `state.ts`, `commands.ts` | Rewrite (CORE §3–5)                                                                                  |
| `src/engine/context.ts`                                                                                                     | `core/order/context.ts`                           | Port; blobs and relative paths instead of absolute paths; add resume, restart, handover, Q&A         |
| `src/engine/watch.ts`                                                                                                       | `core/cycle/watch.ts`                             | Port 1:1                                                                                             |
| `src/engine/__tests__/scenarios.test.ts`, `harness.ts`                                                                      | `core/order/__tests__/`, `core/testing/`          | Each scenario rewritten on v2 events; the list of names is the checklist                             |
| `src/definitions/*`                                                                                                         | `factory-definitions/src/`                        | Port; add snapshot + hash, `schemaVersion: 2`, Station `requires`                                    |
| `roles/`                                                                                                                    | `factory-definitions/operators/`                  | Copy. `operator.md` (v1's on-call role) stays behind until M10; `worker.md` is renamed `builder.md`  |
| `workflows/`                                                                                                                | `factory-definitions/lines/`                      | Copy; move to schema v2                                                                              |
| `templates/`                                                                                                                | `factory-definitions/templates/`                  | Copy; add runtime prompts (answer, nudge, reminders, Handover request)                               |
| `src/prompts/*`                                                                                                             | `apps/server/src/prompts/`                        | Port; relative paths, blob inputs                                                                    |
| `src/adapters/herdr`, `git`, `github`, `system`, `runners/*`                                                                | `apps/cell/src/adapters/`                         | Port with their tests                                                                                |
| `src/supervisor/headless.ts`, `launch.ts`, `gate.ts`, `trust-prompt.ts`, `names.ts`                                         | `apps/cell/src/jobs/`, `apps/cell/src/cycle/`     | Port the logic; drop the store calls                                                                 |
| `src/supervisor/deliver.ts`, `delivery-commit.ts`, `validate-pr.ts`, `format-pr-body.ts`                                    | `apps/cell/src/jobs/deliver.ts`                   | Port the logic; PR body arrives rendered as a blob                                                   |
| `src/supervisor/pick-todo.ts` (frontmatter parsing, dependency rule)                                                        | `factory-definitions/src/`                        | Port the parsing; selection moves to `core/queue`                                                    |
| `src/testing/fake-*.ts`, `store.contract.ts`                                                                                | `core/testing/`, `factory-db` tests               | Port the pattern                                                                                     |
| `src/supervisor/blocked-work.ts`                                                                                            | —                                                 | Replaced by checkpoints on the Work order branch and `factory-wip/*` refs. Read for edge cases.      |
| `src/supervisor/workspace-registry.ts`, `notify.ts`                                                                         | —                                                 | Replaced by the Cell's worktree cache; Herdr toasts are dropped (the board and `/v1/stream` notify). |
| `src/supervisor/run.ts`, `execute.ts`, `reconcile.ts`, `observe.ts`, `operator.ts`, `lock.ts`, `wire.ts`, `task-context.ts` | —                                                 | **Not carried over.** Read them for edge cases only.                                                 |
| `src/cli/*`, `console-lines.ts`, `paint.ts`                                                                                 | —                                                 | Not carried over; the new CLIs are thin clients. Board rendering may borrow from them.               |
