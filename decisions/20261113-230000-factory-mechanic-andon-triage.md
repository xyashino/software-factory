---
scope: factory
summary: The Mechanic (AI, v1's on-call operator) triages every Andon in v2.0 and decides what reaches the Supervisor
why: Most Andons are infrastructure or Station-level stops that a responder can resolve without a person. Routing all of them to the Supervisor makes the person the bottleneck. The Mechanic takes the first decision and escalates only what needs a human.
date: 2026-11-13
tags: [v2, andon, mechanic, supervisor, line-lead, incidents]
---

- **The Mechanic is in v2.0.** It replaces the "Line lead" in the docs and the M10 slot. The name is **Mechanic**; "Line lead" is retired. It is the v1 on-call operator's role, reintroduced as a responder for Andons.
- **Every Andon goes to the Mechanic first.** The Cell is still released at once (R3). The Work order's holder is `mechanic`, not `supervisor`.
- **The Mechanic decides what reaches the Supervisor.** For each Andon it either resolves it (resume, restart from a Station, retry with a note) or escalates it to the Supervisor with a short summary. Nothing reaches the Supervisor without that decision, except what the Mechanic escalates.
- **Questions from Operators go to the Mechanic.** `factory-operator ask` is addressed to the Mechanic. The Mechanic answers, or escalates the question to the Supervisor.
- **The Supervisor stays the person.** The Supervisor operates the `factory` CLI and can always act on any Work order (resume, cancel, reopen, answer, nudge). The Mechanic does not replace that authority.
- **The Mechanic is bounded.** It uses the same commands as the Supervisor, within its own retry and restart budget. Anything beyond that budget, or a Work order it cannot explain, is escalated.
- **The Mechanic never edits the worktree.** It acts through the runtime commands only. Repairing the environment (a runner, a workspace) is a separate, later decision.
- **Updated documents:** `docs/PLAN.md`, `docs/CORE.md`, `docs/WORKFLOW.md`, `docs/OPEN-QUESTIONS.md` (Q14, Q18), `docs/ROADMAP.md` (M10 becomes part of v2.0; schedule to be decided).
- **Naming.** The execution process is a **Cell** (manufacturing cell), `factory-cell` / `apps/cell`, `CellId`. The word Worker is retired in `docs/`. Older decision records keep their original wording.
