# Folder Structure

Where every file of SoftwareFactory lives: the package source, the definitions it reads, and the runtime data it writes. A new file that fits none of the places below needs a change to this document in the same PR.

How the files in `roles/`, `workflows/` and `templates/` are written is in [DEFINITIONS.md](DEFINITIONS.md).

---

## 1. Package

```
packages/software-factory/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── eslint.config.mjs
├── vitest.config.ts
├── README.md
│
├── bin/
│   ├── sf                           shell launcher put on the pane's PATH (runs src/cli.ts)
│   └── software-factory             same launcher under the long name
│
├── roles/                           DEFINITIONS: one file per workstation role
│   ├── planner.md
│   ├── plan-reviewer.md
│   ├── worker.md
│   ├── doctor.md
│   └── operator.md
│
├── workflows/                       DEFINITIONS: one file per assembly line
│   ├── fast.yml
│   ├── feature.yml
│   └── standard.yml
│
├── templates/                       DEFINITIONS: text the supervisor sends
│   ├── prompts/
│   │   ├── answer.md
│   │   ├── cli-guide.md
│   │   ├── context-input.md
│   │   ├── context-input-path.md
│   │   ├── context-note.md
│   │   ├── gate-feedback.md
│   │   ├── gate-pass.md
│   │   ├── incident.md
│   │   ├── nudge-silent.md
│   │   ├── reminder-idle.md
│   │   └── review-feedback.md
│   └── pr/                          PR body templates
│       ├── blocked.md
│       ├── body.md
│       └── report.md
│
├── migrations/                      numbered SQL, applied at store open
│   └── 0001_init.sql
│
├── docs/
│   ├── PLAN.md  STACK.md  RULES.md  STRUCTURE.md  DEFINITIONS.md
│   └── feature-plans/               implemented design specs 01-12
│
└── src/
    ├── cli.ts                       entry point: imports cli/main.ts only
    ├── paths.ts                     every runtime path (see section 3), nothing else builds paths
    ├── paint.ts                     picocolors styling (plain by default)
    ├── describe-step.ts             human text for a workflow step
    ├── format-duration.ts           duration formatting
    │
    ├── definitions/                 load + validate roles, workflows, templates
    │   ├── types.ts
    │   ├── duration.ts
    │   ├── errors.ts
    │   ├── files.ts
    │   ├── frontmatter.ts
    │   ├── role.ts
    │   ├── workflow.ts
    │   ├── validate.ts
    │   ├── load.ts
    │   └── __tests__/
    │       ├── fixtures/
    │       │   ├── valid/           a complete valid tree (roles/, workflows/, templates/)
    │       │   └── invalid/<rule>/  one minimal tree per validation rule
    │       └── *.test.ts
    │
    ├── engine/                      PURE: no imports outside engine/ and definitions/types.ts
    │   ├── events.ts
    │   ├── actions.ts
    │   ├── state.ts
    │   ├── reduce.ts
    │   ├── next-action.ts
    │   ├── watch.ts
    │   ├── context.ts
    │   └── __tests__/
    │       ├── harness.ts
    │       └── *.test.ts
    │
    ├── prompts/                     rendering: definitions + engine context -> text
    │   ├── render.ts
    │   ├── templates.ts             TEMPLATE_VARS + loading
    │   ├── build-prompt.ts
    │   └── __tests__/
    │
    ├── ports/                       interfaces only, no implementations
    │   ├── store.port.ts
    │   ├── herdr.port.ts
    │   ├── git.port.ts
    │   ├── system.port.ts
    │   ├── process.port.ts          argv-only process spawning (headless agents)
    │   ├── github.port.ts
    │   ├── clock.port.ts
    │   └── running-attempt.ts
    │
    ├── adapters/                    one folder per port, real implementations
    │   ├── store/                   schema.ts (Drizzle tables), sqlite-store.ts
    │   ├── herdr/                   herdr.adapter.ts
    │   ├── runners/                 runner.ts, registry.ts, claude.ts codex.ts cursor.ts antigravity.ts opencode.ts
    │   ├── git/                     git.adapter.ts
    │   ├── system/                  system.adapter.ts, process.adapter.ts
    │   ├── github/                  github.adapter.ts
    │   ├── clock/                   system-clock.ts
    │   └── */__tests__/             with recorded command output under fixtures/
    │
    ├── supervisor/                  the imperative shell around the engine
    │   ├── run.ts
    │   ├── wire.ts                  real adapters -> SupervisorPorts
    │   ├── ports.ts                 SupervisorPorts bundle
    │   ├── execute.ts
    │   ├── launch.ts                start an agent attempt in a pane
    │   ├── headless.ts              headless (print mode) agent runs via the process port
    │   ├── observe.ts
    │   ├── reconcile.ts
    │   ├── gate.ts
    │   ├── pick-todo.ts
    │   ├── operator.ts              on-call operator invocation
    │   ├── blocked-work.ts
    │   ├── trust-prompt.ts
    │   ├── workspace-registry.ts
    │   ├── task-context.ts
    │   ├── deliver.ts
    │   ├── delivery-commit.ts
    │   ├── format-pr-body.ts
    │   ├── validate-pr.ts
    │   ├── notify.ts
    │   ├── console-lines.ts
    │   ├── names.ts
    │   ├── util.ts
    │   └── __tests__/
    │
    ├── cli/
    │   ├── main.ts                  citty root, lazy subcommands
    │   ├── caller.ts                FACTORY_* env -> caller
    │   ├── in-pane.ts               shared guard for in-pane commands
    │   ├── guide.ts                 generated CLI guide
    │   ├── management.ts            shared logic for operator-facing commands
    │   ├── read-store.ts            read-only store access for board and log
    │   ├── board.ts                 `sf status` rendering
    │   ├── log-view.ts              `sf log` rendering
    │   ├── reset-action.ts          hard/soft reset execution
    │   └── commands/                one file per command
    │       ├── check.ts  run.ts  status.ts  log.ts  reset.ts
    │       ├── done.ts  verdict.ts
    │       └── ask.ts  tell.ts  answer.ts  escalate.ts  unblock.ts
    │
    └── testing/                     shared test support, imported only by tests
        ├── fake-store.ts
        ├── fake-herdr.ts
        ├── fake-git.ts
        ├── fake-system.ts
        ├── fake-process.ts
        ├── fake-github.ts
        ├── fake-clock.ts
        ├── fake-store.test.ts
        └── store.contract.ts
```

### Import direction

```
cli ──▶ supervisor ──▶ engine ──▶ definitions/types
 │          │  └─────▶ prompts ──▶ definitions
 │          └────────▶ ports ◀── adapters
 └──────────────────▶ adapters (wiring only, in supervisor/wire.ts)
```

- `engine/` imports nothing but itself and `definitions/types.ts`.
- `supervisor/` depends on `ports/`, never on `adapters/`, except `supervisor/wire.ts`, which is the only file that imports adapters. Real adapters are wired in `supervisor/wire.ts`.
- `adapters/` import `ports/` and external libraries, never `supervisor/` or `engine/` (except event types).
- `testing/` is imported only from `__tests__/`.

Enforced with `no-restricted-imports` in `eslint.config.mjs`.

### File naming

- `kebab-case.ts`; ports end in `.port.ts`, adapters in `.adapter.ts`, tests in `.test.ts`.
- One concept per file. No `index.ts` barrels (repo rule).
- Tests live in `__tests__/` next to the code they test.

---

## 2. Definitions location

Roles, workflows and templates live **inside the package**, at `packages/software-factory/{roles,workflows,templates}`. They are versioned with the code that reads them, reviewed in PRs, and checked by `software-factory check` in CI.

- They are resolved from the package root: `new URL('../roles/', import.meta.url)` from `src/`. Never from the current working directory.
- `software-factory check --definitions <dir>` and `loadDefinitions(dir)` accept another root, for tests only.
- No per-repo override directory in the MVP. Add one only when a second repository uses the factory.

---

## 3. Runtime data (repo root, git-ignored)

All paths are built by `src/paths.ts` from `FACTORY_ROOT` (the repo root).

```
<repo>/
├── todos/                                   INPUT, committed: one todo per file
│   └── <taskId>.md
│
├── .worktrees/                              git-ignored
│   └── <taskId>/                            the task's git worktree, branch <type>/<taskId>
│
└── .evidences/                              git-ignored
    ├── factory.db                           SQLite store (+ -wal, -shm)
    ├── supervisor.log                       the supervisor's own log
    └── <taskId>/
        ├── setup.log
        └── <attemptId>/                     <stepId>-<n>, e.g. build-2, quality-gate-1, operator-1
            ├── prompt.md                    exact prompt sent (agent steps)
            ├── <artifact files>             as declared by the role: plan.md, report.md, commit.txt, feedback.md
            └── <n>-<command-slug>.log       full output per gate command (commands steps)
```

Rules:

- `<taskId>` is the todo file name without `.md`.
- Agents write their artifacts only into their own `<attemptId>/` directory; the prompt gives absolute paths (`{{artifactDir}}`, `{{<key>Path}}`).
- Code changes go only into `.worktrees/<taskId>/`.
- Nothing under `.evidences/<taskId>/` is deleted on delivery; it is the audit trail. The worktree and snapshot refs are.
- Snapshot refs: `refs/software-factory/<taskId>/<attemptId>` in the main repository.
- Herdr names: workspace `<taskId>`, tab `<stepId>#<n>`, agent `<taskId>.<attemptId>`.
