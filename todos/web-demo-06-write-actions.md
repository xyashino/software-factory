---
status: todo
factory: v2
plan: web-demo
depends_on: [web-demo-03-read-pages, web-demo-05-auto-register]
priority: medium
line: feature
type: feat
---

# Todo: `web-demo-06-write-actions` — Resume and Delete (Cancel) Work Orders

## 🎯 Objective

Add the two write actions to the work order detail page: **Resume** and **Delete**, where delete sends `cancel`. Protect the POST endpoint against cross-site requests.

---

## 🌐 Context & Problem Statement

- `resume` and `cancel` are existing `WORK_ORDER_ACTIONS` (`apps/factory-server/src/domain/orders/order-state.ts`). No server change.
- The server has no hard delete for Work orders. Delete = cancel, which is terminal. Decision D1 in [the plan](../apps/factory-web-demo/docs/PLAN.md) and the open question there.
- Any page the Supervisor opens can POST to a locally running demo. The action endpoint must reject foreign origins.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-web-demo/src/pages/work-orders/[id].astro`, `src/pages/actions/work-orders/[id]/[action].ts`, `src/lib/write-guard.ts`.
- **Classification**: `Domain Core` (allow-list, origin check, pure), `Web UI` (forms), `Integration` (transition call).
- **Files**:
  - `src/lib/write-guard.ts`: `isAllowedAction(value): value is 'resume' | 'cancel'`, `isSameOrigin(originHeader, requestUrl)`, `canResume(state)` (`paused | blocked | line_unavailable`), `canCancel(state)` (not `delivered | completed | cancelled`).
  - `src/pages/actions/work-orders/[id]/[action].ts`: POST handler.

---

## 🛠️ Implementation Plan

1. `write-guard.ts` (pure) first. Constants above, then the three checks.
2. Detail page: render a **Resume** form when `canResume(state)`, and a **Delete** form when `canCancel(state)`. Delete form has a required checkbox named `confirm` with value `yes`. No JS.
3. POST handler, in order:
   - `Origin` missing or not same-origin: `403`, no factory call;
   - action not in allow-list: `400`, no factory call;
   - `confirm` missing on cancel: `400`, no factory call;
   - otherwise `transitionWorkOrder(id, action)`;
   - success: `303` redirect to `/work-orders/<id>?notice=<text>`;
   - factory `409`: `303` back with `?error=<code>: <message>`, shown on the page.
4. Notice text is server-generated copy, not user input echoed into HTML (Astro escapes anyway; still no raw HTML).
5. Tests:
   - `write-guard.test.ts`: `resume` and `cancel` pass, `pause`, `complete`, `''` fail; `canResume` true only for the three states; `canCancel` false for terminal states; foreign origin fails, same origin passes;
   - `test/blackbox/write-actions.test.ts` (msw factory-server):
     - foreign `Origin` returns `403` and factory mock records zero calls;
     - `action=pause` returns `400`, zero calls;
     - resume with same origin sends `{ action: 'resume' }` once and redirects;
     - cancel without `confirm` returns `400`;
     - cancel with `confirm=yes` sends `{ action: 'cancel' }`;
     - factory `409` redirects with the error text.

---

## ✅ Acceptance Criteria

- [ ] On a `paused` Work order the page shows **Resume**; clicking it sends `POST /api/v1/work-orders/{id}/transitions` with `{ "action": "resume" }` and the page shows the new state.
- [ ] **Delete** is shown only on non-terminal states and requires the confirm checkbox; it sends `{ "action": "cancel" }`; the order then shows `cancelled`.
- [ ] A POST with a foreign or missing `Origin` returns `403` and sends nothing to factory-server.
- [ ] An action other than `resume` or `cancel` returns `400` and sends nothing.
- [ ] A factory `409` is shown on the page as `code: message`.
- [ ] No token value in any response, redirect URL or log.
- [ ] No barrel `index.ts`; no `any`; no `unknown` used as a type; arrow functions only.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence per [evidence](.agents/skills/evidence/SKILL.md): resume round-trip on a running factory-server, and the `403` foreign-origin response.
