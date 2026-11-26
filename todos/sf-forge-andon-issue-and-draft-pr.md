---
status: queued
priority: high
line: feature
type: feat
plan: universal-engine
depends_on: sf-gitlab-provider
---

# sf-forge-andon-issue-and-draft-pr: open Draft PR and Andon Issue on escalated incidents

## Objective

Extend `PrPort` into `ForgePort` (`gh` + `glab`) so escalated incidents automatically push WIP branch, open Draft PR/MR, and open or update `sf:andon` Issue with Mechanic diagnosis, storing `issueUrl` and `draftPrUrl` for CLI and Web UI display.

## Context

Verified paths:

- `apps/sf/src/application/ports/pr.port.ts` defines `PrPort` (`publish`).
- `apps/sf/src/adapters/git/gh.ts`, `glab.ts`, `pr.ts` (added in `sf-gitlab-provider`) dispatch `github` and `gitlab` PR/MR publishing.
- `.factory/templates/pr/blocked.md` exists in repo and is listed as unused in `docs/plans/hq-factory-cell-plan.md`.
- `apps/hq/src/db/schema/incidents.ts` stores `incidents` (`diagnosis`, `reason`, `status`, `triageOwner`) with no forge URL columns yet.
- `packages/hq-contracts/src/incidents.contract.ts` defines incident DTOs consumed by `apps/sf` and `apps/web`.

## Scope

- **Target**: `apps/sf`, `packages/hq-contracts`, `apps/hq`
- **Classification**: `Feature`, `Integration`
- **Dependencies**: `@repo/hq-contracts: workspace:*`
- **Out of scope**: Inbound GitHub/GitLab webhook comment listeners, `apps/web` UI rendering (`web-incidents-module`).

## Verify first

- Confirm `gh pr create --draft`, `gh issue create --label sf:andon`, `gh issue list --search`, `gh issue comment` exit codes and stdout URL format.
- Confirm `glab mr create --draft`, `glab issue create --label sf:andon`, `glab issue list`, `glab issue note` flags and `GITLAB_HOST` behavior.
- Confirm `apps/hq/src/db/pg/migrations` parity requirement when adding `issue_url` and `draft_pr_url` columns to `incidents`.

## Implementation Plan

1. **Forge Port & Adapters (`apps/sf`)**:
   - Expand `apps/sf/src/application/ports/pr.port.ts` (or create `forge.port.ts` re-wired in `context.ts`) with:
     - `publishPr(spec)` (supports `draft?: boolean`, returns `{ url, number? }`).
     - `upsertAndonIssue(spec)` (`cwd`, `provider`, `host?`, `orderSlug`, `title`, `body`, `labels: ['sf:andon']`, returns `{ url, number? }`).
     - `getPrStatus(spec)` (`cwd`, `provider`, `host?`, `branch`, returns `{ state: 'open' | 'merged' | 'closed' | 'none', url?, number?, mergeCommitSha? }`).
   - Implement in `apps/sf/src/adapters/git/gh.ts`, `glab.ts`, and routing adapter `pr.ts`.
2. **Escalation Hook on Factory/Cell (`apps/sf`)**:
   - When incident transitions to `open_supervisor` (Mechanic `escalate` or no Mechanic budget), push WIP branch `factory/<slug>` if commits exist, render blocked body using `.factory/templates/pr/blocked.md` + Mechanic diagnosis, open Draft PR/MR, and open/comment `sf:andon` Issue linking Draft PR and exact resume hints (`sf incident resolve`).
   - Treat forge publish failure on escalation as non-fatal warning recorded in incident detail (never lose the escalation).
3. **Contracts & Storage (`packages/hq-contracts`, `apps/hq`)**:
   - Add optional `issueUrl: string | null` and `draftPrUrl: string | null` to `incidents` schema (SQLite + Postgres migrations) and `packages/hq-contracts/src/incidents.contract.ts`.
   - Accept optional `issueUrl` and `draftPrUrl` on incident escalation / update endpoint.
4. **Tests**:
   - Unit tests for `gh` and `glab` Draft PR, Andon Issue create/update, and `getPrStatus`.
   - Black-box test verifying escalated incident publishes Draft PR + `sf:andon` Issue and records URLs without failing escalation if forge CLI errors.

## Acceptance Criteria

- [ ] `gh` and `glab` adapters create/update Draft PR/MR, create/comment `sf:andon` Issue, and query PR/MR state.
- [ ] Escalated incident (`open_supervisor`) publishes Draft PR (when WIP commits exist) and `sf:andon` Issue with Mechanic diagnosis, persisting `issueUrl` and `draftPrUrl`.
- [ ] Forge CLI failure during escalation logs warning without blocking incident creation.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
