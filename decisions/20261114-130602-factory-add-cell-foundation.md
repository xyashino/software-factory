---
scope: factory
summary: Cell as a socket client with loops, workspace and Inspection jobs
why: The Cell reaches the runtime only over factory.sock, so it needs no database and can run elsewhere.
date: 2026-11-14
tags: [v2, cell, socket, workspace, inspection]
---

- **Socket client only.** `apps/cell` calls `factory-server` over `factory.sock` through `socketFactoryClient`. Lint bans `factory-db`, `factory-definitions` and `factory-runtime`; a boundary test covers the runtime case.
- **Ported from v1.** git, github, herdr, system, process, clock and runners move to `apps/cell/src/adapters` and `ports/`, with their tests. The runner registry test lists runner names inline.
  - `SystemPort.run` takes an optional `signal`. Aborting it kills the process group, as a timeout does.
- **Client.** Each request and answer is validated against its route. Network and 5xx failures retry with the same body and capped backoff. `commandId` is sha256 of the canonical command identity.
- **Timings come from the Factory.** `hello` returns `selfFenceMs`, and the Cell fences at that value. The fence is checked every second, not only at each beat.
- **Loops.** One heartbeat loop for all jobs, one claim loop per slot. A signal is delivered once and acked on the next beat, even when a beat fails in between.
- **Workspace.** One bare mirror per repo URL. One worktree per `workspace.dir`. `sync` runs on every prepare; `setup` runs once per commit (`.cell/cache-<sha>`). LRU evicts beyond `worktree_limit`, never a worktree in use.
- **Inspection order.** Prepare, then `StartCycle` from the worktree HEAD, then the checks, then the read-only check, then `ReportInspection`. `FailCycle` is sent only after the Cycle starts.
- **Config and identity.** `config.toml` is parsed with `Bun.TOML` and checked with zod. The cellId is a ULID kept in `credential` at mode 0600. No dependency beyond the catalog (`zod`, `@types/bun`).
- **Fixture.** `apps/server/src/testing/serve-fixture.ts` seeds one order whose line starts with an inspection. The Cell tests spawn it by path, so the Cell imports no runtime code.
- **Not in this change.** Operator and deliver jobs fail as `UnsupportedJobKind` and are not reported, so their leases lapse. Remote TCP and join come in v2-18; a full leave in factory-m5-leave.
