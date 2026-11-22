---
scope: factory/sf
summary: Add GitHub Copilot CLI as a Cell runner
why: lines and default_runner needed a sixth agent CLI; copilot headless flags verified against installed 1.0.114
date: 2026-11-22
tags: [sf, cell, runner, copilot]
---

- New `apps/sf/src/adapters/runners/copilot.ts`: `copilot -p <prompt> --allow-all-tools --no-ask-user --trust-folder --output-format json [--model m]`.
- `read` permission appends `--deny-tool write` last. Verified: `apply_patch` denied with rule `write`, shell `echo` still runs (`sf operator` works).
- No `buildInteractive`, like codex, cursor, opencode.
- `copilot` added to `RUNNERS` (`packages/cell-contracts`) and `RUNNER_NAMES` (`sf` registry), so `default_runner: copilot` is accepted.
- Docs runner lists in `docs/cell.md` and `docs/sf.md` now name six runners.
- Limit: `session_artifacts` tool still writes Copilot session-store files under `read`; it is not a repo file write.
