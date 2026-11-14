---
scope: factory
summary: Intake, event feed and admin ops run in the runtime over the socket
why: Todos must reach the runtime from git and PRs must report back, with the event feed and admin ops local to the socket.
date: 2026-11-14
tags: [v2, intake, feed, admin, export, e2e]
---

- Intake: `syncProject` in `factory-runtime` reads the base branch through a `GitMirror` port; the git adapter lives in `apps/server` (bare mirror per project under `mirrors/`, `git` subprocess).
- Intake rows: one `intake` row per todo (hash, seen commit, diagnostic). Commands are `CreateOrder`, `UpdateSpec` or `Cancel`, with commandId `intake:<project>:<todo>:<hash>`, so a replayed pass changes nothing.
- Claimed orders: a changed spec or a cancel after the first `job_claimed` records a diagnostic (`spec_drift`, `cancel_after_claim`) and no command.
- Cut-over: `scanTodos` takes only `factory: v2` todos while `v2Only` is on (default on); v1-owned todos are skipped silently.
- Todo hash: `todoContentHash` normalises line endings and trailing spaces before SHA-256, so whitespace edits are not spec drift.
- PR state: `pollPrStates` runs for each delivered Work order whose PR is not merged or closed.
  - It asks a `PrStatePort`, which `apps/server` implements with `gh pr view --json state`.
  - It records `RecordPrState` with commandId `pr:<order>:<state>`.
- Event feed: `GET /v1/stream?after=<globalSeq>` serves SSE from `runtime.feed` alongside `POST /v1/supervisor/events`.
  - The socket client reconnects from the last `globalSeq` it yielded.
- Admin routes: `supervisor/intake/sync`, `supervisor/admin/backup`, `supervisor/admin/export`, `supervisor/admin/rebuild-projections`.
  - Import is not a route: `factory-server admin import` runs one-shot on a stopped server.
- Export layout: `sqliteArchive` delegates `exportTo` and `importFrom` to canonical `exportFactory` / `importFactory` (`STORAGE §7.3`).
  - `backup` runs `VACUUM INTO` and `rebuildProjections` replays the event streams.
- Import: refused unless projects, events and blobs are all empty; rebuilds projections, then appends `ExpireLease` with the active job's epoch for each order whose holder is `cell`.
- Port rename: the PR state port method is `read`, not `fetch`, so `factory-core` keeps its purity guard (no `fetch(` call sites).
- CLI: `apps/cli` (`citty`) exposes `factory sync` and `factory admin <backup|export|import|rebuild-projections>`.
  - It uses its own socket and one-shot client without depending on `@repo/factory-server`.
- E2E: a fixture repo with a v2 todo goes to `delivered` through all six Stations with a scripted Cell on the socket; the PR state reaches `merged` through the poll.
- Restart: a real `factory-server` process is killed with SIGKILL while a build job is claimed, then started again on the same directory.
  - The order still reaches `delivered` with contiguous event seq.
  - The Cell finishes its claimed job, since boot grace extends the lease.
