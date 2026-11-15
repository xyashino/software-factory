---
scope: factory
summary: CLI actions and cycle outcomes; unique Herdr panes
why: Review Cycles stayed running, log -f held factory.lock for 25 s, and pane names collided across Cells
date: 2026-11-15
tags: [cli, ux, log, herdr, mechanic, panes]
---

- `cyclesOf` ends a Cycle on its recorded verdict (`verdict_recorded`) or inspection (`inspection_finished`), labelled `passed` or `failed`.
  - `cycle_*` events keep their own labels: `passed`, `failed`, `blocked`, `handed_over`.
- `factory show` ends with an `actions` section of copy-pasteable next commands for the order's status.
  - andon, waiting_answer, cancelled and queued each get their own commands; other open states get `cancel`; delivered and merged print none.
  - `--json` output is unchanged.
- `factory status` prints an `Action needed` block under the board for rows in `andon`, `waiting_answer`, `waiting_deps` or `deps_broken`, with the reason and the command.
  - `--json` output is unchanged.
- A one-shot run never long-polls: with no socket, a feed poll sends `waitMs: 0`, and `runOnce` clamps it too, so `log -f` with no `factory-server` never holds `factory.lock`.
  - `nextEvents` pauses one second after an empty, early poll, so the follower does not spin.
- Herdr pane names are always `<station>_<hash>_<n>`, where the hash digests the Cycle or Mechanic job id, within the 32-character rule.
  - Two Cells on the same station and attempt no longer share a name.
- The Mechanic opens its pane in the Work order's todo workspace, not an orphan `software-factory:<todo>` one, with the order's log tab.
  - A folder-trust prompt on its pane is confirmed as the station does.
  - A prompt that cannot be confirmed is escalated to the Supervisor.
- `todoOf` moved to `jobs/job-shape.ts` and `logCommandOf` to `jobs/pane-commands.ts`, so the station and the Mechanic share them.
