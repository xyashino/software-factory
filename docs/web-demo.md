# `@repo/web-demo` — plan

A small Astro SSR web server that shows HQ and lets the Supervisor resume or cancel Work orders. It is a client of the HQ server ([`factory.md`](./factory.md)) and holds no state of its own.

It is a demo UI: one process, read pages, two write actions, no client JavaScript, no database.

## 1. Pages and actions

| Path | Kind | Server endpoint |
| :--- | :--- | :-------------- |
| `/` | read | `GET /api/v1/factories`, `GET /api/v1/work-orders`, `GET /api/v1/incidents` (counts) |
| `/factories` | read | `GET /api/v1/factories` (online state and projects per Factory; Cells are not stored in HQ) |
| `/work-orders` | read | `GET /api/v1/work-orders?state=` |
| `/work-orders/[id]` | read + write | `GET /api/v1/work-orders/{id}`; forms below |
| `/incidents` | read | `GET /api/v1/incidents` |
| `POST /actions/work-orders/[id]/[action]` | write | `POST /api/v1/work-orders/{id}/transitions` with `{ action }` |

- **Resume** = `action: 'resume'`. Shown on `paused`, `blocked`, `line_unavailable`.
- **Delete** = `action: 'cancel'`. The server has no hard delete for Work orders. Shown on any state except `delivered`, `completed`, `cancelled`. Needs a confirm checkbox (no JS).
- Allowed actions are an allow-list: `resume`, `cancel`. Anything else is `400`.

## 2. Auto-registration on localhost

Goal: when the demo runs on the same machine as HQ (`apps/factory`), it registers itself without the Supervisor copying a token by hand, the way a Cell enrolls.

Rules:

1. **Only on loopback.** Auto-registration runs only when `FACTORY_URL` host is `127.0.0.1`, `localhost` or `::1`. Any other host requires `FACTORY_TOKEN` set by hand. Never auto-register against a remote server.
2. **Trust = same OS user.** A secret is never sent over the network to get a token. The server writes a join secret to `$FACTORY_DATA_DIR/web-demo.join` (`0600`), the same trust as `sf hq token admin create`. The demo reads it at startup.
3. **Join exchange.** The demo calls `POST /api/v1/tokens/join` with the join secret and gets a session token. The session is `supervisor` kind with only `supervisor:read` and `supervisor:write`. No `admin:tokens`. TTL 24 h.
4. **Keep alive.** The demo rotates its session with `POST /api/v1/tokens/rotate` before expiry (existing route, 60 s grace). The token lives only in process memory.
5. **Missing or refused join** fails startup with a message naming the file or the status. The demo never falls back to an unauthenticated mode.

Open decision: whether the join secret is multi-use for 24 h (simple) or single-use and re-minted on each start (stricter). Recommended: single-use, re-minted by the server on each `sf hq start`.

Note: the join contract in `apps/factory/src/contracts/tokens.contract.ts` takes a `joinSecret` but has no web client kind yet.

## 3. Security

- Writes are reachable from any page the Supervisor opens. Every POST checks `Origin` against the demo's own origin; missing or foreign `Origin` is `403`.
- Binds `127.0.0.1` unless `HOST` is set.
- The session token is never rendered, logged or put in a URL.
- Error pages show a plain message. No stack traces.

## 4. Config

| Env | Default | Required |
| :-- | :------ | :------- |
| `FACTORY_URL` | `http://127.0.0.1:7070` | no. The HQ address (web demo reads this name) |
| `FACTORY_PROJECT_ID` | none | yes |
| `FACTORY_DATA_DIR` | server default | only for auto-register |
| `FACTORY_TOKEN` | none | only for a non-loopback `FACTORY_URL` |
| `HOST` / `PORT` | `127.0.0.1` / `4321` | no |

## 5. Stack and layout

- Astro (`output: 'server'`, `@astrojs/node` standalone), Zod for replies, Vitest, msw for tests.
- Versions from npm at planning time: `astro` `7.4.13`, `@astrojs/node` `11.1.14`. Pin both in root `package.json` `workspaces.catalog` before use.

```text
apps/web-demo/
├── astro.config.mjs
├── README.md
├── src/
│   ├── lib/          config.ts, factory-schemas.ts, factory-client.ts, auto-register.ts, write-guard.ts
│   ├── layouts/      Base.astro
│   └── pages/        index, cells/, work-orders/, incidents, actions/
└── test/             unit/, blackbox/
```

- Dependency direction: `lib/write-guard.ts` and `lib/config.ts` are pure. `lib/factory-client.ts` and `lib/auto-register.ts` do HTTP. Pages use only `lib/`.
- Repo rules apply: no barrel `index.ts`, arrow functions, no `any`, export order per `coding-export-order`.

## 6. Out of scope

Hard delete of Work orders, pause/unpause, reset-to-scratch, incident resolution, SSE stream, visitor login, caching, styling framework, i18n, deployment.
