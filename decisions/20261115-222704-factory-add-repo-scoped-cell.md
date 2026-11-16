---
scope: factory
summary: Scope factory-cell to its repository and register its project
why: A Cell's state and project belong to the repo it runs in, so no manual setup is needed
date: 2026-11-15
tags: [cell, repo-scope, factory-local, project-registry]
---

- `factory-cell` refuses to start outside a repository. `--repo-dir <path>` must be a repository root (holds `.factory/` or `.git`); otherwise the repository is the one the working directory is in.
- `cell_data_dir` defaults to `<repo>/.factory-local/cell` (gitignored). `cell-2`, `cell-3`, ... still come from `claimInstanceDir`.
- The project is `projects[0]` when the config names one, else the repository directory name normalized to a project id.
- At start, before `hello`, the Cell calls `cell/projects/ensure` with the project id and `git remote get-url origin`. A repository with no origin is refused.
- `ensureProject` adds a missing project with the add defaults. An existing project is returned as stored and never changed, so `baseBranch`, `maxRunning` and `depPolicy` survive.
- The route is Cell-authorized over HTTP (`POST /v1/cell/projects/ensure`) and on the socket. The Cell lists the project plus its configured projects at `hello`.
- `factory todos migrate --register` adds an unregistered project from origin with the same defaults. `factory project add` keeps its supervisor semantics.
- Consequence: a repository without origin cannot run a Cell, even when its project is already registered. Its project must be registered from another checkout.
