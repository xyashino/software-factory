# Feature Map

End-to-end feature map across apps and contracts. Terms: [glossary](../README.md#glossary). App boundaries: [boundaries.md](../architecture/boundaries.md).

## 1. Cross-App Capability Matrix

| Feature Domain | `apps/hq` (Control Plane) | `apps/sf` (Factory / Cell / CLI) | `apps/web` & `apps/web-demo` | Wire Contract | Spec |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Project Onboarding** | Register project (`POST /projects`), mint Safe Tokens | `sf init`, `sf setup`, `sf doctor`, `sf project add` | Project filter (`HQ_PROJECT_ID`) | `@repo/hq-contracts` | [sf.md](../apps/sf.md) |
| **Queue & Work Orders** | Parse/export `todos/*.md`, DAG validation, `OrderPlan` & `WorkOrder` state machine | `sf order import\|export\|show\|resume\|cancel`, `sf queue`, `sf plan` | List orders, state filter, detail panel, `pause`/`unpause`/`resume`/`cancel` | `@repo/hq-contracts` | [work-orders.md](./work-orders.md) |
| **Factory & Cell Fleet** | Enroll Factory (`/factories/enroll`), track heartbeats, reap expired leases (60s) | `sf factory connect\|start\|stop`, `sf cell scale\|list`, relay `/relay/*`, self-fence (45s) | `/factories` online status & project counts | `@repo/hq-contracts` | [cells-and-factory.md](./cells-and-factory.md) |
| **Station Execution** | Claim lock, materialize `lineSnapshot`, inline `nextJob` handoff, `epoch` fencing | Worktree setup, spawn runner, `sf operator` loopback (`done`, `verdict`, `block`), `deliver` git push + PR | Live step/job status via `/api/v1/stream` (SSE) | `@repo/hq-contracts`, `operator.contract.ts` | [cells-and-factory.md](./cells-and-factory.md), [operator.md](../apps/operator.md) |
| **Incidents (Andon)** | Open incident on block/exhausted retries, dispatch Mechanic, apply resolution | `sf operator read\|incident` (Mechanic), `sf incident list\|resolve` (Supervisor) | `/incidents` list & order incident details | `@repo/hq-contracts`, `operator.contract.ts` | [incidents.md](./incidents.md) |

## 2. End-to-End Lifecycle Diagram

```mermaid
flowchart TD
  subgraph Onboarding["1. Onboarding & Fleet"]
    P1["sf init (.factory/config.json)"] --> P2["sf project add -> HQ"]
    P2 --> P3["sf factory connect & start"]
    P3 --> P4["sf cell scale N"]
  end

  subgraph Queue["2. Queue & Topology (work-orders.md)"]
    Q1["orders/*.md or todos/*.md"] -->|"sf order import"| Q2[("HQ: OrderPlan & WorkOrder queued")]
  end

  subgraph Execution["3. Cell Execution (cells-and-factory.md)"]
    Q2 -->|"POST /cells/claims"| E1["Cell claims Step 0 (epoch++)"]
    E1 --> E2{"Local .factory/lines/<line>.yml?"}
    E2 -->|no| E3["line_unavailable -> re-dispatch Cell"]
    E2 -->|yes| E4{"Worktree & prior .cell/ files intact?"}
    E4 -->|"no (stepIndex > 0)"| E5["worktree_missing -> scratch reset Step 0"]
    E4 -->|yes| E6["start (lineSnapshot) -> run station"]
    E5 --> E6
    E6 -->|"sf operator done / verdict pass"| E7{"Last step (deliver)?"}
    E7 -->|"no (nextJob inline)"| E4
    E7 -->|yes| E8["git push + gh pr + delete worktree"]
    E8 --> E9["WorkOrder delivered -> unlock child orders"]
  end

  subgraph Recovery["4. Incidents & Andon (incidents.md)"]
    E6 -->|"retries spent / sf operator block"| R1["Incident opened (WorkOrder blocked)"]
    R1 --> R2["Mechanic Job triages (.cell/ logs)"]
    R2 -->|"retry_step / restart_from_step / scratch"| Q2
    R2 -->|"escalate"| R3["Supervisor resolves (sf incident resolve / Web UI)"]
    R3 --> Q2
  end
```

## 3. Feature Specs

- **[work-orders.md](./work-orders.md)**: Markdown format, import/export, queue actions, `OrderPlan` vs standalone branch stacking, `stale_base` rules.
- **[cells-and-factory.md](./cells-and-factory.md)**: Factory daemon supervision, Cell claim/heartbeat loop, start-to-finish ownership, `line_unavailable`, `worktree_missing` scratch reset, worktree layout.
- **[incidents.md](./incidents.md)**: Andon triggers, Mechanic triage state machine, resolution actions (`retry_step`, `restart_from_step`, `restart_from_scratch`, `escalate`, `cancel`).
