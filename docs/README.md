# Docs

Index of project documentation by domain. Each app keeps a short `README.md` pointing here.

```text
docs/
├── README.md                          # Index + Glossary
├── architecture/
│   ├── overview.md                    # System topology & communication graph
│   ├── boundaries.md                  # Business boundaries (Owns / Never Owns / Talks To)
│   └── engineering.md                 # Layering, SQLite/Postgres transactions, testing
├── features/
│   ├── README.md                      # Feature map (capability matrix + lifecycle Mermaid)
│   ├── work-orders.md                 # Queue, markdown format, OrderPlan branch stacking
│   ├── cells-and-factory.md           # Factory daemon, Cell lifecycle, worktrees, scratch reset
│   └── incidents.md                   # Andon triggers, Mechanic triage, Supervisor resolution
├── apps/
│   ├── hq.md                          # apps/hq control plane server, tokens, agent reporting
│   ├── sf.md                          # apps/sf CLI, commands, production lines
│   ├── operator.md                    # sf operator loopback client, verbs, exit codes
│   └── web.md                         # apps/web (EDA SPA + BFF) & apps/web-demo
└── plans/
    ├── hq-factory-cell-plan.md        # HQ / Factory / Cell status & remaining gaps
    ├── standalone-factory-plan.md     # Plan to extract apps/factory & support --local
    └── onboarding-plan.md             # CI onboarding smoke test gap
```

## 1. Architecture & Business Boundaries

- **[architecture/overview.md](./architecture/overview.md)**: Apps, packages, who calls whom, system Mermaid graph.
- **[architecture/boundaries.md](./architecture/boundaries.md)**: Strict app scope matrix (`Owns` / `Never Owns` / `Talks To` / `Auth`).
- **[architecture/engineering.md](./architecture/engineering.md)**: Clean architecture DAG, Zod contracts, Hono adapters, SQLite/Postgres concurrency, 3-tier test pyramid.

## 2. Features & Domain Flows

- **[features/README.md](./features/README.md)**: Cross-app feature capability matrix + end-to-end Mermaid flow.
- **[features/work-orders.md](./features/work-orders.md)**: `orders/*.md` / `todos/*.md` format, import/export, queue actions, `OrderPlan` branch stacking, `stale_base`.
- **[features/cells-and-factory.md](./features/cells-and-factory.md)**: Factory daemon (`127.0.0.1:7072`), Cell claim/heartbeat loop, start-to-finish ownership, `line_unavailable`, `worktree_missing` scratch reset.
- **[features/incidents.md](./features/incidents.md)**: Andon triggers, Mechanic triage state machine, resolution paths.

## 3. Apps

- **[apps/hq.md](./apps/hq.md)**: `@repo/hq` control plane storage, exclusivity indexes, Safe Tokens, agent reporting idempotency.
- **[apps/sf.md](./apps/sf.md)**: `sf` CLI command tree, install/quickstart, HQ connection resolver, production lines.
- **[apps/operator.md](./apps/operator.md)**: `sf operator` agent client verbs, validation split, exit codes.
- **[apps/web.md](./apps/web.md)**: `@repo/web` (5-layer RxJS EDA SPA + Astro BFF) and `@repo/web-demo` (zero-JS Astro SSR).

## 4. Plans & Repo Rules

- **[plans/hq-factory-cell-plan.md](./plans/hq-factory-cell-plan.md)**: HQ, Factory, Cell design status and open gaps.
- **[plans/standalone-factory-plan.md](./plans/standalone-factory-plan.md)**: Plan to extract `apps/factory` and support `--local` mode without HQ.
- **[plans/onboarding-plan.md](./plans/onboarding-plan.md)**: Open CI smoke-test gap.
- **Repo rules (style, commits, tests)**: `.nitpick/`, generated into `AGENTS.md`, `CLAUDE.md`, and `.agents/`.

## Glossary

Defined once here. Other docs link to this section.

| Term           | Meaning                                                                                                    |
| :------------- | :--------------------------------------------------------------------------------------------------------- |
| **HQ**         | External control plane (`apps/hq`): state, queue, projects, work orders, jobs, leases, transition log      |
| **Factory**    | Local daemon (`sf factory`), one per PC. Only holder of HQ credential. Spawns, supervises, kills Cells     |
| **Cell**       | Disposable worker (`sf cell`): one process, one job at a time, runs inside repo. Talks only to its Factory |
| **Project**    | Repo containing `.factory/config.json` (field `project`)                                                   |
| **Line**       | Declarative workflow: ordered list of Stations (`.factory/lines/<name>.yml`)                               |
| **Station**    | One step of a Line: an Operator run, deterministic Inspection, or Deliver step                             |
| **Operator**   | LLM agent running one Station of a Line                                                                    |
| **Mechanic**   | LLM agent that triages an Incident when a Line is blocked                                                  |
| **Job**        | One execution attempt of one Station (or Mechanic run), claimed by a Cell                                  |
| **Incident**   | Andon: block that normal retries could not fix. Releases Cell lease while keeping worktree for triage      |
| **Work order** | One `orders/*.md` item travelling down a Line (`todos/*.md` read as fallback)                              |
| **Supervisor** | Human who operates HQ (`sf` CLI / Web UI) and resolves escalated Incidents                                 |
