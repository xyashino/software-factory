# `@repo/web`

Reference Event-Driven Architecture (EDA) frontend for Software Factory, living alongside `apps/web-demo`.

## Stack

- **BFF**: Astro SSR (`@astrojs/node` standalone) proxying `/api/work-orders*` and `/api/stream` (SSE) to HQ with an in-memory `web_session` token and `Origin` CSRF guard.
- **SPA**: React 19 + TanStack Router + Tailwind CSS v4 + shadcn/ui (Radix UI + CVA + `lucide-react`) with semantic tokens and dark mode.
- **EDA**: RxJS `TRIGGER` / `TASK` / `FACT` / `EFFECT` bus (`src/libs/eda/eda.ts`) + per-module 5-layer slices (`configuration/`, `domain/`, `core/`, `integration/`, `presentation/`).

## Reference module

`src/modules/work-orders/` implements the full pattern end-to-end:

- List + state filter (`switchMap` cancels stale requests)
- Detail panel (steps, jobs, incidents)
- Transitions (`pause`, `unpause`, `resume`, `cancel` with confirmation dialog + toasts)
- Live SSE sync (`src/shared/data-sync/integration/data-sync.ts`) with reconnect & tab-wake catch-up

## Run locally

```bash
HQ_PROJECT_ID=<project-id> bun --filter @repo/web dev
```

Default URL: `http://127.0.0.1:4322` (runs side-by-side with `apps/web-demo` on `4321`).
