---
status: todo
priority: medium
depends_on: [factory-demo-04-order-plans-and-intake]
line: feature
factory: v2
plan: factory-demo
---

# factory-demo-05: Cells, Join Tokens, Projects, Admin, and UI polish

## Objective

Complete `apps/factory-demo` with Cells & Join Tokens, Projects Registry CRUD, Admin operations, theme/a11y controls, and app documentation.

## Read first

- `packages/factory-core/src/contracts/supervisor.ts` (`cellsList`, `joinToken*`, `project*`, `admin*`)
- `apps/cli/src/commands/cells.ts`, `project.ts`, `admin.ts`
- `.agents/references/frontend-architecture.md`
- `.agents/rules/ui.md`, `.agents/rules/ux.md`, `.agents/rules/accessibility.md`, `.agents/rules/styling.md`, `.agents/rules/msw-backend-mocks.md`

## Deliverables

1. **`src/modules/cells/`:**
   - Cells list (`cellId`, `name`, `lastSeenAt`, `revokedAt`) + revoke Cell with confirmation dialog and optimistic toast.
   - Join Tokens list (`joinTokenId`, `name`, `createdAt`, `expiresAt`, `revokedAt`), create join token form (`name`, optional `ttlSeconds`) displaying one-time copyable `token` secret banner, revoke token with confirmation.
2. **`src/modules/projects/`:**
   - Projects table/cards (`projectId`, `repoUrl`, `baseBranch`, `maxRunning`, `depPolicy`).
   - Add project form (`projectId`, `repoUrl`, `baseBranch`, `maxRunning`, `depPolicy`), edit settings (`baseBranch`, `maxRunning`, `depPolicy`), remove project with confirmation.
3. **`src/modules/admin/`:**
   - Trigger `Rebuild Projections` (`rows` count result).
   - Export Archive button downloading decoded base64 archive JSON from `GET /api/admin/export`.
4. **Shell polish, A11y & Docs:**
   - Header controls for Dark/Light theme toggle and accessibility preferences (reduced motion, high contrast, font scale) backed by CSS tokens in `src/styles/theme.css`.
   - Verify mobile-first responsive layout across `320, 480, 640, 768, 1024, 1280, 1440, 1920` breakpoints with zero text/control overlap.
   - Add `apps/factory-demo/README.md` with env vars (`FACTORY_URL`, `FACTORY_TOKEN`) and dev/build commands.
5. **Tests & ADR:**
   - Black-box AAA tests with `msw` for Cells/Join Tokens, Projects CRUD, Admin actions, and theme/a11y controls.
   - One `decisions/` ADR entry.

## Acceptance criteria

- [ ] Full `factory-server` HTTP management surface (`board`, `orders`, `plans`, `cells`, `join-tokens`, `projects`, `admin`, `blobs`, `stream`) usable from `apps/factory-demo`.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test`, and `pnpm format:check`, and `pnpm --filter @repo/factory-demo build` pass.
