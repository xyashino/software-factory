---
scope: factory
summary: Expose HQ version and warn on CLI and web version drift
why: sf is a standalone binary while HQ and apps/web run as daemons, so upgrades left them on different builds with silent contract mismatches
date: 2026-11-25
tags: [factory, hq, sf, web, version, drift, doctor]
---

- `GET /api/v1/version` on HQ is public and returns `{ code, version, protocolVersion }`.
  - `version` is HQ's `package.json` version.
  - `protocolVersion` is `HQ_PROTOCOL_VERSION` in `@repo/hq-contracts/version.contract`.
- `sf doctor` compares its `package.json` version with the server's.
  - A mismatch is `warn`, not `missing`, so doctor still passes.
  - A server without the route (404) also warns.
- `apps/web` serves `GET /api/version` with its own `package.json` version.
  - The client records the first answer as baseline.
  - It re-checks on tab focus and on each stream reconnect (`live`).
  - A different answer shows a dismissible refresh banner.
- Drift only appears after a version bump: every package is still `0.0.0`, so bump on release.
- Not in this change: comparing protocol versions in `sf doctor`, or checking HQ's version from `apps/web`.
- Tests: `version.test.ts` (HQ black box), `doctor.procedure.test.ts` (match, mismatch, missing endpoint), `app-update-banner.test.tsx` (MSW: unchanged, changed, dismissed).
