---
status: todo
priority: low
workflow: feature
factory: v2
---

# v2-clean-logs-tab: clear echoed command in Herdr logs tab

## Objective

Restore v1's clean `logs` tab launch in `apps/cell` so running `factory log <orderId> -f` in the workspace's `logs` pane clears the echoed command and initial shell prompt (including scrollback) and `exec`s into the log follower directly, matching `packages/software-factory/src/supervisor/launch.ts`.

## Read first

- `packages/software-factory/src/supervisor/launch.ts` (`ensureWorkspace`, `printf '\\033[2J\\033[3J\\033[H' && exec ...`)
- `packages/software-factory/src/supervisor/__tests__/workspace-recovery.test.ts`
- `apps/cell/src/runners/herdr-pane.ts` (`workspaceOf`)
- `apps/cell/src/jobs/run-operator-station.ts` (`logCommandOf`)
- `apps/cell/src/__tests__/unit/claude-trust.test.ts` (`the logs tab of a task workspace`)

## Deliverables

1. **Wrap `logCommand` with screen/scrollback clear + `exec` in `apps/cell/src/runners/herdr-pane.ts`:**
   - In `workspaceOf`, when launching `logCommand` via `herdr pane run`, send `printf '\\033[2J\\033[3J\\033[H' && exec ${logCommand}` (optionally with a leading space if shell history suppression is desired, or matching exact v1 prefix) so the echoed `"$bun" ".../cli.ts" log ... -f` command and shell prompt above it are wiped from both visible screen and scrollback before `factory log -f` renders.
   - Keep `logCommandOf` in `apps/cell/src/jobs/run-operator-station.ts` clean so callers/tests continue passing the raw command string into `pane.open({ logCommand })`.
2. **Tests (`RULES §6.3`):**
   - Update `apps/cell/src/__tests__/unit/claude-trust.test.ts` (`the logs tab of a task workspace`) to assert `herdr pane run` receives `printf '\\033[2J\\033[3J\\033[H' && exec <logCommand>`.
3. **ADR:**
   - One `decisions/` entry recording the change.

## Acceptance criteria

- [ ] `pnpm --filter @repo/factory-cell check-types`, `lint`, and `test` pass.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test`, and `pnpm format:check` pass.
