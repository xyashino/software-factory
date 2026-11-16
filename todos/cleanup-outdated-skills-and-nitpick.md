---
status: todo
priority: low
depends_on: []
line: standard
factory: v2
type: chore
---

# cleanup-outdated-skills-and-nitpick: Remove outdated skills/agents and update only `vps-gon-stack` and `create-todo`

## Objective

Delete `.nitpick/agents/`, remove all skills that contain outdated `omino` / `romantic-app` / v0 `packages/factory` rules or dead references, update **only** `vps-gon-stack` and `create-todo` to match current v1/v2 Software Factory architecture, clean `.nitpick/config.ts` and `.nitpick/references/frontend-architecture.md`, and regenerate `.agents/` via `pnpm nitpick:sync`.

## Read first

- `.nitpick/config.ts`
- `.nitpick/agents/factory.md`, `worker.md`, `doctor.md`
- `.nitpick/references/frontend-architecture.md`
- `.nitpick/skills/feature-workflow/SKILL.md`
- `.nitpick/skills/create-todo/SKILL.md`
- `.nitpick/skills/vps-gon-stack/SKILL.md`, `scripts/*`, `references/manual-steps.md`
- `packages/factory-definitions/src/todo.ts`, `packages/factory-definitions/starter/.factory/lines/`
- `packages/software-factory/src/cli/main.ts`, `packages/software-factory/src/paths.ts`, `packages/software-factory/src/supervisor/pick-todo.ts`
- `apps/cli/src/cli.ts`, `apps/cell/src/config.ts`
- `deploy/systemd/factory-server.service`, `deploy/systemd/factory-cell.service`

## Deliverables

1. **Delete `.nitpick/agents/`:**
   - Remove `.nitpick/agents/factory.md`, `.nitpick/agents/worker.md`, and `.nitpick/agents/doctor.md` (unreferenced legacy agent definitions).

2. **Remove outdated skills (do not rewrite/patch them):**
   - Delete `.nitpick/skills/boss-factory/`
   - Delete `.nitpick/skills/setup-factory/`
   - Delete `.nitpick/skills/create-pr/`
   - Delete `.nitpick/skills/plan-domain/`
   - Delete `.nitpick/skills/plan-fe/`
   - Delete `.nitpick/skills/async-implement/`
   - Delete `.nitpick/skills/witch-doctor/`
   - Delete `.nitpick/skills/run-workflow/`
   - Unregister all deleted skills from `skills` in `.nitpick/config.ts`.
   - Remove dangling references to deleted `plan-domain` and `plan-fe` from `.nitpick/skills/feature-workflow/SKILL.md`.

3. **Update only `create-todo` and `vps-gon-stack`:**
   - `create-todo` (`.nitpick/skills/create-todo/SKILL.md`):
     - Remove obsolete `execute: { runner, tier }`, `review: { runner, tier }`, `packages/factory/src/config/models.json`, and `pnpm factory models`.
     - Match actual parsers (`packages/factory-definitions/src/todo.ts`, `pick-todo.ts`): `status`, `priority`, `depends_on`, `workflow` (v1) / `line` (v2), `type` (v2), `plan` (v2), `factory: v2`.
     - Replace `omino` monorepo examples (`@repo/astro-config`, `@repo/uih`, `@repo/ui`) with packages/apps from this repo.
   - `vps-gon-stack` (`.nitpick/skills/vps-gon-stack/SKILL.md`, `scripts/*`, `references/manual-steps.md`):
     - Remove hardcoded `https://github.com/xyashino/omino.git` and `~/workspaces/omino` across `SKILL.md`, `setup-tools.sh`, `setup-git.sh`, `setup-env.sh`, `setup-service.sh`, and `references/manual-steps.md` (parameterize repo URL / workspace path or point to this repo).
     - Replace `omino-factory.service` / `omino-factory.timer` (`Type=oneshot` for `pnpm factory` / `--dry-run`) in `setup-service.sh` and docs with current `Type=simple` units in `deploy/systemd/factory-server.service` and `deploy/systemd/factory-cell.service` (and note v1 `pnpm sf:run` if applicable).
     - Remove nonexistent `packages/factory/src/config/models.json` reference from `main.sh`.
     - Update `setup-tools.sh`: drop `@repo/vibe-test` Playwright install and install `bun` (required by v1 and v2).
     - Update `setup-env.sh`: remove `omino-api`, `.dev.vars.example`, and Postgres `docker-compose.yml` (factory uses SQLite).

4. **Update `.nitpick/config.ts`, `.nitpick/references/frontend-architecture.md`, and sync `.agents/`:**
   - `.nitpick/config.ts`: update `entry` and `agents.factory` to reflect current v1 (`pnpm sf`) / v2 (`factory-server`, `factory-cell`, `pnpm factory`) workflow; remove references to `packages/factory`, `models.json`, `pnpm factory models`, `execute: { runner, tier }`, `pnpm factory --dry-run`, `factory/<id>`, `factory-blocked`, and `omino-factory.timer`.
   - `.nitpick/references/frontend-architecture.md`: replace `apps/romantic-app/...` and `apps/parka/...` examples with repo-neutral or current repo examples.
   - Run `pnpm nitpick:sync` so `.agents/` matches `.nitpick/` (removing deleted skills from `.agents/skills/` as well).
   - Add one ADR entry in `decisions/`.

## Acceptance criteria

- [ ] `.nitpick/agents/` directory is removed.
- [ ] Outdated skills (`boss-factory`, `setup-factory`, `create-pr`, `plan-domain`, `plan-fe`, `async-implement`, `witch-doctor`, `run-workflow`) are deleted from both `.nitpick/skills/` and `.agents/skills/`, and removed from `.nitpick/config.ts`.
- [ ] Only `create-todo` and `vps-gon-stack` are updated among the listed skills, and both accurately match v1 (`pnpm sf`) / v2 (`apps/cli`, `apps/cell`, `apps/server`, `packages/factory-definitions/src/todo.ts`, `deploy/systemd/`).
- [ ] No stale references to `omino`, `romantic-app`, `parka`, `packages/factory`, `models.json`, `pnpm factory sync`, `FACTORY_V2_ONLY`, `@repo/vibe-test`, `plan-ui`, or `migrate-workflows` remain in `.nitpick/` or `.agents/`.
- [ ] `pnpm nitpick:sync` keeps `.agents/` in sync with `.nitpick/`.
- [ ] `pnpm format:check`, `pnpm check-types`, `pnpm lint`, and `pnpm test` pass.
