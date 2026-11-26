---
status: queued
priority: high
line: standard
type: feat
plan: universal-engine
---

# sf-gitlab-provider: add GitLab provider support via glab with PR metadata return

## Objective

Add `github` and `gitlab` (including self-hosted host) provider support in `apps/sf`, auto-detect provider and host from `origin` during `sf init` / `sf setup`, return `{ url, number? }` from `PrPort.publish`, and make `sf doctor` check provider-matching CLI auth.

## Context

`apps/hq`, `apps/web`, and `apps/sf/src/adapters/git/git.ts` are provider-agnostic (`git` uses `origin`, HQ stores `repoUrl` as plain string, `apps/sf/src/domain/init/project-id.ts` handles nested GitLab subgroups). GitHub coupling sits in four places in `apps/sf`:

- `apps/sf/src/adapters/git/gh.ts`: only `PrPort` adapter (`gh pr view|create|edit`), currently returns `Promise<void>`.
- `apps/sf/src/bootstrap/context.ts`: hardcodes `pr: createPrAdapter(processPort)` from `adapters/git/gh.ts`.
- `apps/sf/src/application/procedures/doctor/doctor.procedure.ts`: hardcodes `gh auth status`.
- `apps/sf/src/domain/repo-config/parse-repo-config.ts`: only parses `project`, `rules`, `skills` with no git provider fields.

`apps/sf/src/application/ports/process.port.ts` already accepts optional `env?: Readonly<Record<string, string>>` in `ProcessPort.run`, so self-hosted `GITLAB_HOST` passes cleanly without port changes.

## Scope

- **Target**: `apps/sf`
- **Classification**: `Integration`
- **Dependencies**: none (uses existing `zod`, `citty`, `ProcessPort`)
- **Out of scope**: GitLab REST API adapter, Draft PR / Andon Issue creation (`sf-forge-andon-issue-and-draft-pr`), `apps/hq` or `apps/web` MR link UI, plain branch-only delivery without PR/MR.

## Verify first

- Confirm target `glab` CLI flags, stdout URL format, and exit codes for `glab mr view <branch>`, `glab mr update <branch> --title <t> --description <b>`, `glab mr create --source-branch <branch> --target-branch <base> --title <t> --description <b> --yes`, and `glab auth status [--hostname <host>]`.
- Confirm `glab` honors `GITLAB_HOST` env var when `git.host` differs from `origin` remote host.
- Confirm `gh pr create` and `gh pr edit` stdout URL format (or `gh pr view <branch> --json url,number`).

## Implementation Plan

1. **Files**:
   - Create `apps/sf/src/domain/git/detect-provider.ts`: pure helper inferring `{ provider: 'github' | 'gitlab', host?: string }` from git remote URL (`github.com` -> `github`; `gitlab.com` or hostname containing `gitlab` -> `gitlab` + `host` when non-default; fallback `github`).
   - Create `apps/sf/src/adapters/git/glab.ts` (`glab` `PrPort` adapter returning `{ url, number? }`).
   - Create `apps/sf/src/adapters/git/pr.ts` (routing `PrPort` adapter dispatching `'github'` -> `gh`, `'gitlab'` -> `glab`).
   - Modify `apps/sf/src/adapters/git/gh.ts`: return `PublishedPr` (`{ url: string; number?: number }`) from `publish`.
   - Modify `apps/sf/src/domain/repo-config/parse-repo-config.ts`: add optional `git?: { provider: 'github' | 'gitlab'; host?: string }` (default provider `'github'`).
   - Modify `apps/sf/src/domain/init/templates.ts`: extend `repoConfigText` to include `git` block when provider/host supplied.
   - Modify `apps/sf/src/application/ports/pr.port.ts`: add `PublishedPr` (`{ url: string; number?: number }`), update `publish(spec: PrSpec): Promise<PublishedPr>`, add optional `provider?: 'github' | 'gitlab'` and `host?: string` to `PrSpec`.
   - Modify `apps/sf/src/bootstrap/context.ts`: wire routing PR adapter (`gh` + `glab`) in `buildContext`.
   - Modify `apps/sf/src/application/procedures/cell/deliver.procedure.ts` and `apps/sf/src/application/procedures/cell/run-job.procedure.ts`: read `git.provider` and `git.host` from `.factory/config.json` (fallback `'github'`), pass into `ports.pr.publish`, and record returned `{ url, number }` in delivery result output.
   - Modify `apps/sf/src/application/procedures/doctor/doctor.procedure.ts`: inspect `.factory/config.json` `git` config; check `gh auth status` for `github`, or `glab auth status` (with `--hostname <host>` when `git.host` set) for `gitlab` with provider-specific install/login fix hints.
   - Modify `apps/sf/src/application/procedures/init/init.procedure.ts`, `apps/sf/src/application/procedures/setup/setup.procedure.ts`, `apps/sf/src/adapters/cli/init.command.ts`, `apps/sf/src/adapters/cli/setup.command.ts`: add `--provider <github|gitlab>` and `--git-host <host>` flags; auto-detect from `origin` remote when flags omitted.
   - Add/update tests in `apps/sf/test/unit/adapters/git/`, `apps/sf/test/unit/domain/parse-repo-config.test.ts`, `apps/sf/test/unit/domain/init-templates.test.ts`, `apps/sf/test/unit/application/init.test.ts`, `apps/sf/test/unit/application/deliver.test.ts`, `apps/sf/test/unit/application/procedures/doctor/doctor.procedure.test.ts`, `apps/sf/test/unit/application/procedures/setup/setup.procedure.test.ts`, and `apps/sf/test/blackbox/git-deliver.test.ts`.
2. **Behavior**:
   - Missing `git` block in `.factory/config.json` defaults to `provider: 'github'` (backwards compatible).
   - `git.host` rejects empty/whitespace strings when provided; passed to `glab` via `{ GITLAB_HOST: host }` env override on `ProcessPort.run` and `--hostname <host>` in `glab auth status`.
   - `glab` adapter checks existing MR for `spec.branch`, updates title/description if present, else creates MR targeting `spec.baseBranch` non-interactively; returns `{ url, number? }`; throws clear error on non-zero exit.
   - Exhaustive discriminated switch on `provider` (`'github' | 'gitlab'`) in routing PR adapter and doctor check.
3. **Integration**:
   - `sf init` / `sf setup` auto-detect GitLab from `origin` remote or honor explicit `--provider gitlab --git-host gitlab.company.com`, persisting `git` config in `.factory/config.json`.
   - `deliverWorkOrder` passes resolved `provider` and `host` to `ports.pr.publish` and exposes returned PR/MR URL.
   - `runDoctor` reports `glab` check instead of `gh` when repo configures `gitlab`.

## Acceptance Criteria

- [ ] `.factory/config.json` parses optional `git: { provider: 'github' | 'gitlab', host?: string }` and defaults missing `git` to `github`.
- [ ] `sf init` and `sf setup` accept `--provider` and `--git-host`, auto-detect from `origin` when omitted, and persist in `.factory/config.json`.
- [ ] Delivery routes `github` to `gh` and `gitlab` to `glab`, returning `{ url, number? }` on create and update, passing `GITLAB_HOST` when `host` set.
- [ ] `sf doctor` checks `glab auth status` (with `--hostname <host>` when set) for `gitlab` repos and `gh auth status` for `github` repos.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
