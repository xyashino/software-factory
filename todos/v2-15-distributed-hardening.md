---
status: todo
priority: high
depends_on: [v2-13-worker-delivery, v2-14-clis, v2-18-remote-http-adapter]
workflow: feature
---

# v2-15: Distributed hardening — takeover, partition, duplicates, Andon, leave, race

## Objective

Prove R2, R3 and R8 with real processes and a hostile network.

## Read first

- `docs/PLAN.md` requirements and F3–F5, `docs/PROTOCOL.md` §5, §8.2, §11, `docs/RULES.md` §6.5
- `docs/ROADMAP.md` M7

## Scope (ROADMAP items)

`factory-m7-harness`, `factory-m7-takeover`, `factory-m7-partition`, `factory-m7-duplicates`,
`factory-m7-andon-resume`, `factory-m7-leave`, `factory-m7-race`.

## Deliverables

1. Harness: one Factory process (`factory-server`), N Worker processes, fake runner, local bare git remote,
   a TCP proxy per Worker that can drop, delay or cut traffic. Workers connect over the Unix socket when
   local and over TCP when remote.
2. Tests:
   - `kill -9` a Worker mid-Cycle → another Worker restarts the Station; no double work;
   - partition a Worker → self-fence, `stale_epoch` on return, no push from the fenced Worker;
   - drop responses → no duplicate events, continuation delivered once;
   - Operator blocks on Worker A; A takes other work at once; resume on Worker B from the WIP
     checkpoint; passed Stations not rerun;
   - `SIGTERM` a Worker mid-Cycle → Handover; Worker B continues without the Supervisor;
   - 10 Workers, 50 Work orders, Workers joining and leaving → every Work order delivered exactly once.
3. CI job running the suite.

## Acceptance criteria

- All tests run in CI and pass 20 consecutive runs without a flake.
- Any bug found comes with a failing test first (RULES §6.3) and a docs fix if the design was wrong.
