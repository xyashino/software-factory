---
scope: factory
summary: RunnerPort declares interactive start and availability; headless reports unavailable
why: Untracked herdr runner and routing code already call interactive members; the pre-push check-types run failed on the missing port members.
date: 2026-11-19
tags: [factory, runner, herdr, typecheck]
---

- `RunSpec` gains optional `interactive`. Absent or false means headless.
- `RunnerPort` gains `interactiveAvailable(): Promise<boolean>`.
- `createHeadlessRunner` returns `false`: it never runs a TUI, so the routing runner always picks headless for it.
- Herdr and routing runner files stay untracked; this change only types the port they already use.
