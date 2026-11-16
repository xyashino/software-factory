---
status: todo
priority: medium
depends_on: []
line: feature
type: refactor
---

# Todo: Move the Cell config from TOML to JSON in `.factory/config.json`

## 🎯 Objective

Make the repository's `.factory/config.json` the single committed config for the Cell, and have the Cell read it as JSON instead of `.factory/cell.toml`. The machine-local override moves the same way.

---

## 🌐 Context & Problem Statement

The Cell reads `<repo>/.factory/cell.toml` (committed) and `<repo>/.factory-local/cell.toml` (local override) through `apps/cell/src/repo-config.ts` and `apps/cell/src/config.ts`. Its parser is `Bun.TOML.parse` plus a zod schema that refuses unknown keys.

`.factory/config.json` already exists, and the nitpick catalog reads its `rules` and `skills` keys (`packages/factory-definitions/src/nitpick-catalog.ts`). Keeping two repo config files, one JSON and one TOML, splits the repo's configuration for no benefit. The Cell's settings would sit next to the rules they depend on.

The Cell is also meant to run only inside a repo whose `.factory/config.json` exists. Today `findRepoRoot` accepts a `.factory/` directory or a `.git` instead.

Settings that depend on this move:
- `herdr.tabPerRun`, `herdr.closePreviousOperatorTabs` (see `todos/mechanic-own-tab.md`)
- `logs.store`, `logs.dir` (see `todos/move-log-blobs-to-files.md`)
- `mechanic.rootRecordDir` (see `todos/restore-mechanic-role.md`)

---

## 📦 Specification / Scope

- **Target**: `apps/cell/src/config.ts`, `apps/cell/src/repo-config.ts`, `apps/cell/src/repo-project.ts` (`findRepoRoot`), `packages/factory-definitions/src/nitpick-catalog.ts` (must ignore Cell keys), `.nitpick/skills/setup-factory/SKILL.md`, `docs/` references to `cell.toml`.
- **Classification**: `Integration` / `Infrastructure`
- **Dependencies**: none new. `Bun.TOML` is no longer used by the Cell; `JSON.parse` replaces it.

Decisions to confirm before implementing:

1. **Keep the machine-local override?** Option A: `.factory-local/config.json` overrides `.factory/config.json` key by key (same as today). Option B: no override; the machine config lives only in `~/.config/factory-cell/config.json`. This todo assumes A.
2. **Shared file, two readers.** `.factory/config.json` is read by the nitpick catalog (`rules`, `skills`) and by the Cell. The Cell parser must accept the catalog keys, and the catalog reader must accept the Cell keys. Neither may refuse the other's keys.
3. **Repo marker.** The Cell requires `.factory/config.json` to exist in the repo root. This todo assumes that: `findRepoRoot` looks for that file, not a `.factory/` directory.

---

## 🛠️ Implementation Plan

1. **Schema**: rewrite the zod schema in `apps/cell/src/config.ts` for JSON. Add `herdr`, `logs` and `mechanic` objects with the keys listed above. Keep the existing keys (`projects`, `runners`, `capabilities`, `factory_data_dir`, `cell_data_dir`, `worktree_limit`, `factory_url`, `headless_operators`, `notifications`), renamed to camelCase if the JSON style requires it, with the rename recorded in the todo's change log.
2. **Two-reader rule**: the Cell's schema allows the catalog keys (`rules`, `skills`) and ignores them; the catalog reader ignores the Cell keys. Both still refuse keys that neither owns.
3. **Reading**: `readPartialConfig` parses JSON. Keep the `repo` file and the `local` file merge order: local overrides committed, key by key.
4. **Repo root**: `findRepoRoot` looks for `.factory/config.json`. Refuse with a clear message when it is missing.
5. **Remove TOML**: delete the `cell.toml` paths and the `Bun.TOML` use. Update `setup-factory` SKILL.md section 3 (it writes `config.toml`, which is now `config.json`) and any `docs/` reference.
6. **Migration**: if `.factory/cell.toml` exists, the Cell refuses to start and names the file to convert, instead of silently ignoring it.

---

## ✅ Acceptance Criteria

- [ ] The Cell reads `.factory/config.json` and `.factory-local/config.json`, local overriding committed key by key.
- [ ] `herdr`, `logs` and `mechanic` keys are accepted and validated; an unknown Cell key is refused with its path named.
- [ ] `rules` and `skills` are accepted by the Cell and ignored; the nitpick catalog ignores the Cell keys.
- [ ] `findRepoRoot` requires `.factory/config.json`; a repo without it is refused with a clear message.
- [ ] A leftover `.factory/cell.toml` makes the Cell refuse to start and names the file.
- [ ] No `Bun.TOML` use remains in `apps/cell`.
- [ ] `setup-factory` writes `config.json`, not `config.toml`.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Exactly one new `decisions/` entry for this change.
