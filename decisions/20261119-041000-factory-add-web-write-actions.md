---
scope: factory
summary: Web demo adds Resume and Delete (cancel) on work orders
why: Supervisor acts from the demo; POST must reject foreign origins since any open page can post to localhost.
date: 2026-11-19
tags: [factory, web-demo, write-actions, security]
---

- Detail page shows **Resume** on `paused | blocked | line_unavailable`, **Delete** on every state except `delivered | completed | cancelled`.
- Delete is `cancel` (terminal). No hard delete exists on the server. Delete form needs checkbox `confirm=yes`, no JS.
- `POST /actions/work-orders/:id/:action` (`write-guard.ts` pure checks):
  - `Origin` must match the `Host` header, else `403`
  - action outside `resume|cancel` is `400`
  - `cancel` without `confirm=yes` is `400`
  - all three run before any factory call
- Origin is checked against `Host`, not `request.url`: the Node adapter builds `request.url` from `localhost`, so Astro's built-in origin check is disabled (`security.checkOrigin: false`) and this route owns the check.
- Factory `409` redirects `303` to the detail page with `?error=<code>: <message>`. Success redirects with `?notice=<server copy>`. Pages render both as escaped text.
- `FactoryUnavailable` carries the factory error `detail` (message) next to `code`. Token never reaches a redirect, body or log.
