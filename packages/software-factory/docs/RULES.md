# SoftwareFactory Implementation Rules

Hard rules for every change in `packages/software-factory`, by humans or agents. A change that breaks one of them is rejected in review. Changing a rule needs a `decisions/` entry and an edit to this file in the same PR.

The repo-wide rules in `.nitpick/config.ts` (coding, git, decision log) still apply. This file only adds what is specific to the factory.

**MUST** = no exceptions. **MUST NOT** = no exceptions. **SHOULD** = deviate only with a written reason in the PR.

---

## 1. Engine

1. The engine (`src/engine/`) **MUST** be pure: no I/O, no `Date.now()`, no `Math.random()`, no environment reads, no logging. Time, ids and observations are passed in as arguments.
2. `src/engine/` **MUST NOT** import from `adapters/`, `supervisor/`, `cli/`, `bun:*` or `node:*`. It may import from `definitions/` types only.
3. Every task decision **MUST** be derived from the workflow plus the task's event history. The engine **MUST NOT** keep state between calls.
4. Given the same workflow, events and `now`, `nextAction` **MUST** return the same action.
5. No LLM call **MUST** ever decide a transition, a retry or a block.
6. Every engine branch **MUST** have a test that drives it through events alone, with no fakes.

## 2. Events and Store

1. Events are append-only. Code **MUST NOT** update or delete an event row.
2. A side effect **MUST** be bracketed by events: record the intent (`*_started`) before acting and the outcome after. A restart that finds an intent without an outcome **MUST** reconcile it (see `feature-plans/04-supervisor.md`).
3. State that matters across a restart **MUST NOT** live only in memory. In-memory caches are allowed only if they can be rebuilt from the store.
4. The database **MUST** open with `journal_mode = WAL`, `busy_timeout = 5000` and `foreign_keys = ON`.
5. Schema changes **MUST** be new numbered SQL migration files. An applied migration **MUST NOT** be edited.
6. Event payloads **MUST** be validated with zod when read back, not only when written.

## 3. Definitions (Roles, Workflows, Templates)

1. Adding or changing a role, workflow or prompt template **MUST NOT** require TypeScript changes. Exception: registering a new template id in `TEMPLATE_VARS`, or a new input kind in `src/definitions/workflow.ts` and `src/engine/context.ts`, is a TypeScript change made once, in the same PR as the text that uses it.
2. Roles **MUST NOT** name a runner or a model. Workflows **MUST NOT** contain prompt text.
3. Every invalid definition **MUST** be rejected by `software-factory check` before anything runs, with the file path and the field in the message.
4. Every `{{variable}}` in a role or template **MUST** be resolvable at load time. An unknown variable is a load error, never an empty string.
5. Roles, workflows and templates **MUST** be read from disk at runtime, never bundled into code.
6. Definitions **MUST** follow the storage and writing rules in [DEFINITIONS.md](DEFINITIONS.md); new source files **MUST** go where [STRUCTURE.md](STRUCTURE.md) puts them.
7. Judging roles **MUST NOT** edit the worktree. They fail with feedback; the worker fixes.

## 4. Runners and Herdr

1. Only the Herdr adapter (pane agents) and the headless runner through the process port (`src/supervisor/headless.ts`) **MUST** start, prompt, read or stop an agent. Headless runs use argv, never a shell. Nothing else spawns an agent process.
2. Runner-specific code (kind, model flag, permission flags) **MUST** live only in `src/adapters/runners/<runner>.ts`. `if (runner === '...')` anywhere else is forbidden.
3. Agents **MUST** run interactively in Herdr panes by default. Headless mode (`claude -p`, `codex exec`) is opt-in per workflow agent with `headless: true` (default `false`, see [DEFINITIONS.md](DEFINITIONS.md)) and **MUST** be used only with runners that support print mode. A headless agent **MUST NOT** be run through a shell.
4. Every Herdr call **MUST** have a timeout and **MUST** surface failure as a typed error, never as an empty result.
5. Agents **MUST** reach the harness only through the `software-factory` CLI. No runner plugins, MCP servers or custom tools.

## 5. Execution

1. At most one agent or one command step **MUST** run in a worktree at any time.
2. The MVP **MUST** run one task at a time.
3. Every agent step and command step **MUST** have a timeout. No unbounded waits anywhere in the supervisor.
4. Each attempt **MUST** start a fresh agent session. Context reaches a new attempt only through `inputs` and recorded feedback.
5. A snapshot ref **MUST** exist before an attempt starts. Only the supervisor restores snapshots, and only to restart after an infrastructure failure.
6. Agents and the Operator **MUST NOT** restore, reset or revert the worktree through the harness.
7. Gate commands **MUST** be run one by one as declared, never joined into one shell script.

## 6. Prompts and Feedback

1. Gate output **MUST** be cleaned with `stripVTControlCharacters` and truncated to its last 12,000 characters before it reaches a prompt. The full log **MUST** be saved as an artifact and its path given.
2. An input artifact over 12,000 characters **MUST NOT** be inlined; the prompt gives its absolute path.
3. Every prompt **MUST** end with the generated `software-factory` CLI guide for that attempt.
4. Prompt text **MUST** live in `roles/` or `templates/`, never in TypeScript string literals.

## 7. CLI

1. Every citty subcommand **MUST** lazy-import its handler inside `run()`.
2. In-pane commands (`done`, `verdict`, `ask`, `tell`) **MUST** identify the caller only from `FACTORY_ROOT`, `FACTORY_TASK` and `FACTORY_ATTEMPT`, and **MUST** reject a call for an attempt that is not running.
3. In-pane commands **MUST NOT** load workflow parsers or git code.
4. A rejected command **MUST** exit non-zero with a message that tells the agent exactly what to fix.

## 8. Dependencies

1. Runtime dependencies are `citty`, `drizzle-orm`, `picocolors`, `yaml` and `zod`. Adding one **MUST** come with a `decisions/` entry.
2. LLM SDKs and HTTP clients **MUST NOT** be added. The only ORM is `drizzle-orm`, as the store query layer over `bun:sqlite` (see `decisions/20261111-120051-factory-replace-sqlite-raw-sql-drizzle.md`).
3. Versions **MUST** come from the workspace catalog (`catalog:`).

## 9. Testing

1. The engine and definitions **MUST** be covered by tests that need no Herdr, git, network or real database.
2. Every port **MUST** have an in-memory fake in `src/testing/`, used by supervisor tests.
3. Adapters **SHOULD** be tested against recorded command output, not live services.
4. A bug fix **MUST** come with a test that fails before the fix.
5. Tests **MUST NOT** mock internal functions of the module under test. Replace ports, not implementation details.

## 10. Reuse

1. Code that exists in `packages/factory` for Herdr, git, runners, todos, branches or PR delivery **SHOULD** be ported with its tests rather than rewritten.
2. Ported code **MUST** be adapted to these rules (ports, typed errors, no prompt literals) in the same PR that ports it.
