---
scope: factory/projects
summary: Projects are added, changed and removed over every transport
why: A fresh data directory needs no seedProject or SQLite access to register a project
date: 2026-11-14
tags: [v2, projects, registry, cli, storage]
---

- Store writes return a result union, not a throw: `ProjectStore.add`, `set` and `remove` answer `{ok: true}` or `{ok: false, reason}`.
  - `reason` is one of `exists | missing | has_history | base_branch_busy`.
  - `factory-db` never imports runtime errors; the runtime maps each reason to a `precondition` refusal, and `missing` to `not_found`.
- Guards run in the store, inside the writer lock and one synchronous section of the statement gate:
  - `add` refuses an existing `projectId`.
  - `remove` refuses while `orders`, `events` or `intake` hold the project.
  - `set` refuses a `baseBranch` change while a Work order of the project is not terminal.
- `repoUrl` is immutable: the patch type and the strict zod schema both reject it, so a project with another repository is removed and added again, since mirrors and Cell checkouts would go stale.
- Cells serve only the projects their config lists (`projects` in `config.toml`); a new project reaches a Cell only after that Cell lists it, and the CLI prints that hint on stderr.
- `projects` is mutable configuration, not an event stream: no Traveler records a change, export and import carry it, and a projection rebuild does not touch it (STORAGE §4).
- v2-21 pins the base branch per Work order; until then `set --base-branch` is allowed only while no Work order of the project is open.
- Replays take no `commandId` dedupe: a replayed add is refused as `exists`, so the registry is idempotent in its state, not in its answer.
- `seedProject` stays a test and fixture helper with an optional `depPolicy`; the runtime never inserts a project itself.
