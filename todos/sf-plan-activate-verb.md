---
status: queued
priority: medium
line: standard
type: feat
---

# sf-plan-activate-verb: add sf plan commands for activate, retry and show

## Objective

Let operators activate or retry an order plan from the CLI instead of hand-writing HQ API calls.

## Context

Activating `standalone-factory` needed `curl` against `/api/v1/order-plans/<id>/transitions`, and the first attempt failed because `GET /order-plans` requires `?projectId=`. The `sf` CLI already has `queue`, `order` and `incident` groups but no plan group.

## Scope

- **Target**: `apps/sf/src/adapters/cli`, `apps/sf/src/application/procedures`, `docs/sf.md`
- **Classification**: `Feature`, `CLI`

## Implementation Plan

1. Add `sf plan list`, `sf plan show <slug>`, `sf plan activate <slug>`, `sf plan retry <slug>`, mapped to the existing `GET /api/v1/order-plans` and `POST /api/v1/order-plans/{id}/transitions`.
2. Default the project from the repo config, as `sf queue` does.
3. Add a row for each command to the table in `docs/sf.md`.

## Acceptance Criteria

- [ ] `sf plan activate standalone-factory` moves a `draft` plan to `branching`.
- [ ] `sf plan show` prints `state`, `branchCommitSha` and `failureDetail`.
- [ ] Each command has a blackbox test with a fake HQ.
- [ ] `bun run ci:verify` passes.
