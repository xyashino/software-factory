---
name: factory
description: Backlog runner — operates `pnpm factory`: todos/ queue, execute / review per task with the agent CLI set per role, one PR per task for dev acceptance.
---

# Factory

The backlog runs as a program, not as a chat: `pnpm factory` (`packages/factory`). On the VPS a systemd timer starts it ([vps-gon-stack](../skills/vps-gon-stack/SKILL.md)). You help the dev feed and operate it. Never do the pipeline by hand.

## Queue (`todos/`)

Every `todos/<id>.md` starts with frontmatter (write new ones with [create-todo](../skills/create-todo/SKILL.md)):

```yaml
---
status: todo # todo | done | cancelled
priority: medium # high | medium | low
depends_on: [other-id] # optional, waits until those are done
type: feat # optional change category: feat | fix | chore | refactor | docs | test | perf | build | ci | style | revert (branch <type>/<id>)
execute: { runner: claude, tier: light } # optional override per role: execute | review
---
```

- Defaults per role live in `packages/factory/src/config/models.json` `roles` (`pnpm factory models`). Optional `runner` (`cursor | antigravity | claude | codex | opencode`) and `tier` (`advanced | default | light`) override that row.
- Ready = `status: todo`, dependencies `done`, no open `factory/<id>` PR, no open `factory-blocked` issue. Order: priority, then id.

## One pass

1. Clean tree and no unpushed `main` commits, else stop (never drops dev work).
2. Per ready task, one at a time, on branch `factory/<id>` from `origin/main`:
   - execute (writes code, tests, one `decisions/` entry, proof, `.evidences/<id>/commit.txt`),
   - review (read-only) → `VERDICT: pass | fail`; fail goes back to execute with the problems,
   - pass → task set to `status: done`, commit through the normal hooks (hook failure goes back to execute), push, PR.
3. Dev accepts on the PR (merge) or closes it (task is picked again unless set to `cancelled` or changed).
4. Task cannot finish (rounds limit, timeout, no verdict, read-only agent edited files) → `factory-blocked` issue; close it to retry.
5. Agent CLI fails (signed out, missing) → the pass stops, nothing is reported as done.

## Commands

- `pnpm factory --dry-run`: ready tasks in order with the agent per role, nothing runs.
- `pnpm factory`: one pass (local or VPS). Base checkout must be on `main`; the pass runs `git pull --ff-only` first. `depends_on` unlocks only after the dependency PR is merged.
- VPS: `systemctl --user enable --now omino-factory.timer`, logs `journalctl --user -u omino-factory -f`.

## Rules

- Interactive single tasks go to [worker](worker.md), then [doctor](doctor.md).
- Stop and yield on personal or sensitive data (`rules/security.md`).
