---
scope: software-factory/web
summary: Add apps/web EDA reference app with shadcn/ui and work-orders
why: Give software-factory a scalable RxJS EDA frontend reference alongside web-demo without breaking existing SSR demo
date: 2026-11-24
tags: [web, eda, shadcn, work-orders]
---

- Add `apps/web` (`@repo/web`) alongside `apps/web-demo` on default port 4322
  - Astro Node SSR BFF proxies `/api/work-orders*` and `/api/stream` (SSE) to HQ with in-memory `web_session` token and `Origin` CSRF guard
  - Browser SPA never receives `HQ_TOKEN` or `web_session`
- Add React 19, TanStack Router, Tailwind CSS v4, shadcn/ui primitives (Radix UI, CVA, `lucide-react`), and single-file semantic design tokens with dark mode
- Port RxJS `TRIGGER`/`TASK`/`FACT`/`EFFECT` EDA library (`src/libs/eda/eda.ts`, `with-eda.tsx`) and SSE reconnect watcher (`src/shared/data-sync/integration/data-sync.ts`) from `gon-stack`
- Implement `src/modules/work-orders/` as 5-layer reference slice (`configuration/`, `domain/`, `core/`, `integration/`, `presentation/`)
  - List + state filter, detail panel, `pause`/`unpause`/`resume`/`cancel` actions with confirmation dialog, toasts, and live SSE background refresh
- Add unit tests for transition rules and BFF write guard plus MSW black-box UI tests
