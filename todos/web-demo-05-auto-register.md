---
status: todo
factory: v2
plan: web-demo
depends_on: [web-demo-04-server-web-join]
priority: medium
line: feature
type: feat
---

# Todo: `web-demo-05-auto-register` — Register on Loopback Like a Cell

## 🎯 Objective

On startup, when factory-server is on loopback, the demo reads the join secret, exchanges it for a session token, and keeps that token fresh by rotating it. No manual token setup on the same machine.

---

## 🌐 Context & Problem Statement

- Rules and trust model: [PLAN §2](../apps/factory-web-demo/docs/PLAN.md).
- Needs the server route from task 04 and the client from task 02.
- A non-loopback `FACTORY_URL` must still require `FACTORY_TOKEN`. Auto-registration must never run against a remote host.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-web-demo/src/lib/`, `src/lib/config.ts`, `src/server-start.ts` (or the Astro startup hook).
- **Classification**: `Domain Core` (loopback check, pure), `Integration` (join and rotate calls).
- **Files**:
  - `src/lib/loopback.ts`: `isLoopbackUrl(url)` for `127.0.0.1`, `localhost`, `::1` (pure).
  - `src/lib/auto-register.ts`: `registerSession({ baseUrl, dataDir, read, fetch, clock })` returns `{ token, expiresAt }`; `rotateSession(session)`.
  - `src/lib/session.ts`: in-memory holder with `current()` and `set()`. No module-level state beyond this one holder created in startup.
  - `src/lib/config.ts`: `FACTORY_TOKEN` is required only when `isLoopbackUrl(FACTORY_URL)` is false.

---

## 🛠️ Implementation Plan

1. **Startup order**:
   - if `FACTORY_TOKEN` is set, use it and skip registration;
   - else if `FACTORY_URL` is not loopback, fail with a message naming `FACTORY_TOKEN`;
   - else read `$FACTORY_DATA_DIR/web-demo.join`, call `POST /api/v1/tokens/join`, store the session.
2. **Missing join file** (factory-server never started, or wrong `FACTORY_DATA_DIR`): fail with a message naming the path. No fallback.
3. **Join refused** (`401`, `403`): fail with server `code: message`. The secret is never printed.
4. **Keep alive**: rotate with `POST /api/v1/tokens/rotate` when less than 1 h of TTL remains, checked before each factory call (cheap comparison, no timer). On rotation failure, re-run the join once.
5. **Errors**: any failure during a page request after startup yields `503` (task 03 rule).
6. Tests:
   - `isLoopbackUrl`: `127.0.0.1`, `localhost`, `::1` true; `example.com`, `10.0.0.5` false;
   - non-loopback URL without `FACTORY_TOKEN` throws at config load;
   - join missing file throws naming the path;
   - rotation runs when TTL under 1 h, not otherwise (fake clock);
   - the session token never appears in thrown messages (msw mocks factory-server).

---

## ✅ Acceptance Criteria

- [ ] Starting the demo with factory-server running on `127.0.0.1` and no `FACTORY_TOKEN` serves `/cells` with `200`, without any manual token step.
- [ ] Starting with `FACTORY_URL=https://factory.example.com` and no `FACTORY_TOKEN` fails at startup, naming `FACTORY_TOKEN`.
- [ ] Missing `web-demo.join` fails at startup, naming the path.
- [ ] A refused join fails with the server `code: message`; the secret never appears in output.
- [ ] A session near expiry is rotated, and the new token is used for the next call.
- [ ] Session token and join secret never appear in logs, responses, or thrown messages.
- [ ] No barrel `index.ts`; no `any`; no module-level mutable state except the single session holder.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence per [evidence](.agents/skills/evidence/SKILL.md): startup log showing registration without `FACTORY_TOKEN`, and the failure message for a remote URL.
