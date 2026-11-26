# Web UIs (`apps/web` & `apps/web-demo`)

Two stateless Supervisor web frontends talking to `apps/hq` (`/api/v1/*`). Neither holds a database or direct repo access.

- Terms: [glossary](../README.md#glossary)
- Business boundaries: [boundaries.md](../architecture/boundaries.md)
- HQ tokens: [hq.md §3](./hq.md#3-safe-tokens)

## 1. `apps/web` vs `apps/web-demo`

| App | Default Port | Stack | Purpose |
| :--- | :--- | :--- | :--- |
| **`apps/web`** (`@repo/web`) | `4322` | Astro SSR BFF + React 19 SPA + TanStack Router + RxJS EDA bus + Tailwind v4 + shadcn/ui | Reference full-featured Supervisor dashboard with live SSE sync (`pause`, `unpause`, `resume`, `cancel`) |
| **`apps/web-demo`** (`@repo/web-demo`) | `4321` | Astro SSR (`@astrojs/node`), zero client JS | Minimal SSR dashboard served by `sf web start` (`resume`, `cancel`) |

## 2. Auto-Registration & Session Security (Shared BFF Pattern)

1. **Loopback auto-join**: When `HQ_URL` is `127.0.0.1`, `localhost`, or `::1`, startup reads `$HQ_DATA_DIR/web-demo.join` (`0600`, written by HQ on start) and exchanges it once at `POST /api/v1/tokens/join` for an in-memory `web_session` token (`supervisor:read`, `supervisor:write`, 24h TTL).
2. **Remote HQ**: Non-loopback `HQ_URL` requires explicit `HQ_TOKEN`. Never auto-registers over network.
3. **Rotation**: Rotates `web_session` before expiry via `POST /api/v1/tokens/rotate` (60s grace).
4. **CSRF guard**: Every write POST verifies `Origin` header matches web server origin; mismatch returns `403`. Token never leaves server memory.

## 3. Configuration

| Env | Default | Required |
| :--- | :--- | :--- |
| `HQ_URL` | `http://127.0.0.1:7070` | no (`FACTORY_URL` fallback) |
| `HQ_PROJECT_ID` | none | yes |
| `HQ_DATA_DIR` | HQ default | for loopback auto-join |
| `HQ_TOKEN` | none | for non-loopback `HQ_URL` |
| `HOST` / `PORT` | `127.0.0.1` / `4321` (`web-demo`) or `4322` (`web`) | no |

## 4. `apps/web` 5-Layer EDA Architecture

Each feature module (`apps/web/src/modules/<feature>/`) isolates layers around the RxJS event bus (`TRIGGER` / `TASK` / `FACT` / `EFFECT` in `src/libs/eda/eda.ts`):

```text
apps/web/src/
├── libs/eda/                 # RxJS event bus primitives
├── pages/                    # Astro SSR BFF routes (/api/work-orders*, /api/stream) + SPA entry
├── shared/data-sync/         # SSE live sync + reconnect / tab-wake catch-up
└── modules/work-orders/
    ├── configuration/        # Module wiring & token bindings
    ├── domain/               # Pure domain types & state predicates
    ├── core/                 # Reactive streams, state stores, action handlers
    ├── integration/          # BFF HTTP client adapters
    └── presentation/         # React 19 views & components
```

## 5. Routes & Actions

| UI / BFF Route | Method | Upstream HQ Endpoint |
| :--- | :--- | :--- |
| `/` (overview), `/factories`, `/work-orders`, `/incidents` | `GET` | `GET /api/v1/factories`, `/api/v1/work-orders`, `/api/v1/incidents` |
| `/work-orders/[id]` | `GET` | `GET /api/v1/work-orders/{id}` |
| `/api/stream` (`apps/web`) | `GET` (SSE) | `GET /api/v1/stream` |
| Work order transitions (`pause`, `unpause`, `resume`, `cancel`) | `POST` | `POST /api/v1/work-orders/{id}/transitions` |
