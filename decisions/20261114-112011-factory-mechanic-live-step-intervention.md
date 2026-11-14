---
scope: factory
summary: Allow the Mechanic to intervene during a live Operator Cycle
why: Reactive Andon triage forces waiting for timeouts; letting the Mechanic nudge or answer mid-Cycle resolves stuck Operators faster.
date: 2026-11-14
tags: [v2, mechanic, operator, nudge, cycle, intervention]
---

- **Live-Cycle Mechanic intervention**: extend the Mechanic (M10, `decisions/20261113-230000-factory-mechanic-andon-triage.md`) beyond post-Andon triage so it can intervene while an Operator Cycle is running.
- **Mid-Cycle triggers**: the runtime invokes the Mechanic on `question_asked`, or when a Cell reports repeated `idle` / `silent` reminders past a stall-alert threshold before `timeoutMs` expires.
- **Allowed live-step commands**: the Mechanic uses `Nudge` (to guide a looping or stalled Operator), `Answer` (to unblock `factory-operator ask`), or `Cancel` / Supervisor escalation, within its own budget; it still never edits the worktree or pushes git branches.
- **Live pane-tail context**: when raising a mid-Cycle stall alert, the Cell uploads the sanitized tail of the pane/runtime journal as a blob so the Mechanic sees what the Operator is stuck on without waiting for Cycle end.
- **Auditable actor**: add `{ kind: 'mechanic'; name: string }` to `StoredEvent.actor` and command callers (`Answer`, `Nudge`, `Resume`, `Cancel`) in `CORE.md` so Mechanic actions remain distinct from human Supervisor actions (R5).
- **Updated documents**: `docs/CORE.md`, `docs/PROTOCOL.md`, `docs/ROADMAP.md`.
