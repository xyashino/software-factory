---
scope: factory
summary: Cells pick a Factory project, clone a workspace when needed
why: repo config auto-selects the project; outside a repo the Factory project list drives the choice
date: 2026-11-21
tags: [cell, cli, project]
---

- `sf cell create` and `sf cell start` resolve the project in order: repo `.factory/config.json` (auto), `--project <id>`, then a TTY numbered picker.
- Repo config project is verified on `GET /api/v1/projects`; missing gives exit `1` with hint `sf project add <id> --repo <url>`.
- `--project` disagreeing with repo config gives exit `2`.
- Outside a repo with no registered project: exit `1`, hint `sf project add`.
- Outside a repo, non-TTY, no `--project`: exit `2`, lists project ids.
- Unregistered `--project`: exit `1`, hint `sf project add <id>`.
- Picker runs only when stdin is a TTY; it lists `projectId`, `repoUrl`, `defaultBaseBranch`.
- Chosen project without repo config: clone `repoUrl` into `$XDG_DATA_HOME/sf/workspaces/<projectId>`.
- Existing workspace reused only when origin matches `repoUrl` and tree is clean; else exit `1`.
- Workspace must have `.factory/config.json` and `.factory/lines/*.yml`; else exit `2`.
- `cell create` spawns the worker with cwd = resolved repo root; the worker re-resolves via its repo config.
- `cell start` keeps the slot claim on cwd; only the run uses the resolved root.
- Repo config with no supervisor token (join-token-only worker) skips the project list and trusts the repo config.
- `GitPort` gains `clone(url, dest)` and `originUrl(cwd)`.
- cell-server `POST /api/v1/cells` accepts `projectId` without `repoRoot`; `repoRoot` or `projectId` required.
- cell-server lists projects with the factory supervisor token; unknown project gives `404` with `sf project add` hint.
- cell-server clones or reuses `$XDG_DATA_HOME/sf/workspaces/<projectId>`; clone failure gives `502`, no fallback.
- cell-server `projectId` differing from the inspected repo's project gives `409`.
- cell-server needs `git` on the host.
- Enrollment, claim loop and the factory project list procedure are unchanged; `listProjects` is reused.
