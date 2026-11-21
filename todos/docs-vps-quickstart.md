---
status: queued
priority: low
line: fast
type: docs
depends_on: sf-setup
---

# docs-vps-quickstart: VPS and headless setup with troubleshooting

## Objective

Docs cover a fresh VPS end to end and the failures we hit.

## Context

README quickstart assumes a laptop. First VPS run failed on: install path, a leaked server on port 7070, 401 with a misleading hint. See `docs/onboarding-plan.md`.

## Scope

- **Target**: README install section and the docs location from `docs-restructure-root`
- **Classification**: `Universal Tooling`
- **Out of scope**: code changes.

## Verify first

- Docs layout: has `docs-restructure-root` landed? Put the page where that plan says; otherwise a section in README.
- Final flow after `sf setup`, `sf service install` and the release installer, if they landed.

## Implementation Plan

1. **Content**: prerequisites; install; `sf setup`; web UI via `ssh -L 4321:127.0.0.1:4321`; `FACTORY_HOST` only behind Tailscale or TLS; log in each runner CLI on the VPS; service units or `tmux`.
2. **Troubleshooting table**: port 7070 in use, 401 after token create, missing runner, install path error. Give the check and the fix for each.
3. **Style**: short, ASCII, no emoji.

## Acceptance Criteria

- [ ] Every command in the page was run or matches current `sf --help`.
- [ ] Troubleshooting covers the four failures above.
- [ ] No relative link broken.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
