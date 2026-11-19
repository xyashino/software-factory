---
scope: factory
summary: Add factory cell start, list and revoke with a fake runner
why: Cells need one client that enrolls, claims and reports Job transitions to the server.
date: 2026-11-19
tags: [factory, cli, cell]
---

- `factory cell start`: enroll with `FACTORY_JOIN_TOKEN` only when no session is stored, then `hello`, then the claim loop with `waitMs: 25000`.
- Join token is never written. Session `{cellId, sessionToken}` goes to `.factory-local/cell.json`, mode `0600`.
- `hello` takes `projectId` from `.factory/config.json`. `allowedLines` are the `.factory/lines/*.yml` names.
- Line check: missing or invalid line file sends `line_unavailable` and no `start`.
- Worktree check: a missing `.cell/worktree.json` or prior `.cell/<step-id>/state.json` sends `worktree_missing`, then runs the step 0 job it returns.
- `start`, `complete`, `fail` and `block` transitions send `commandId = sha256(cellId|orderId|epoch|command)`. A retry after network error reuses the id.
- Heartbeat every 10 s with an injected clock. Four failed beats or a server `abort` stop the runner.
- Operator verbs `done`, `verdict` and `block` end the job. Each job gets a random cycle token that the operator handler checks.
- `cell list` shows id, project, state, active job and last heartbeat.
- `cell revoke --id <id> --yes` deletes the cell. Without `--yes` it exits 2 and sends nothing.
- Runner registry and operator HTTP adapter are not built. `cell start` refuses until cli-09 registers a runner.
- No drain route is called. `cell stop` waits for cli-11.
- Application layer imports no Node builtin. Path join is a pure helper in `domain/common`.
