# Onboarding Plan

## Goal

Fresh machine (VPS) to running factory in few commands, with clear errors.

## Status

Landed: every todo except `onboarding-smoke-test`. Install source path, port-owner checks, 401 hint, `sf project add` defaults, `sf doctor`, `sf setup`, systemd units, release binary, `--paused` import, VPS docs.

## Open

- `onboarding-smoke-test`: CI never runs install or quickstart. `pr-ci.yml` runs `turbo run ... test build` only. `apps/sf/test/blackbox/standalone-external-repo.test.ts` needs `apps/sf/dist/sf` and web build, skipped without them. Fix: CI builds `build:sf`, runs `scripts/install.mjs --source apps/sf/dist`, then quickstart in clean env.

## Verify

`bun run ci:verify`.
