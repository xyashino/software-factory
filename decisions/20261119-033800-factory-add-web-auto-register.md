---
scope: factory
summary: Web demo registers on loopback and rotates its session
why: Same-machine demo should start without a pasted token, like cells enroll; remote hosts keep FACTORY_TOKEN.
date: 2026-11-19
tags: [factory, web-demo, auth]
---

- Startup: `FACTORY_TOKEN` set means used as-is, no registration. Else loopback `FACTORY_URL` reads `$FACTORY_DATA_DIR/web-demo.join` and calls `POST /api/v1/tokens/join`. Only the expiry is logged.
- Config: non-loopback `FACTORY_URL` without `FACTORY_TOKEN` fails load, naming `FACTORY_TOKEN`. Loopback without a token needs `FACTORY_DATA_DIR`.
- `isLoopbackUrl` (pure) matches `127.0.0.1`, `localhost`, `::1`. Invalid URL is not loopback.
- Session holder in `session.ts` is the single module-level state. Rotates via `POST /api/v1/tokens/rotate` when under 1 h TTL, checked per request. No timer.
- Failed rotation re-runs the join once. Request-time failure maps to `FactoryUnavailable`, so pages answer `503`.
- Join file missing or join refused fails startup. Messages name the path or `code: message`; the secret is never printed.
- Join secret is single use: a second demo start against the same factory-server run gets `401`. Restart factory-server to mint a new secret.
- `server-entry.ts` loads startup before the Astro adapter, so a failed join stops boot before the server listens.
