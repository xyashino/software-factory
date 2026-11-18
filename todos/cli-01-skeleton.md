---
status: todo
factory: v2
plan: factory-cli
priority: high
line: feature
type: feat
---

# Todo: `cli-01-skeleton` — Package, Entrypoint and Shared Domain Basics

## 🎯 Objective

Create `apps/factory` as a buildable, testable package with one `factory` entrypoint, the config constants, the branded ids, and the exit-code model. No command does anything yet.

---

## 🌐 Context & Problem Statement

- `apps/factory/docs/PLAN.md` defines one binary for the Supervisor, the Cell daemon and the operator verbs.
- The new approach runs alongside the current implementation (PLAN §8.3). `apps/cli` already declares a bin named `factory` (`apps/cli/package.json`). Two packages with the same bin name confuse `pnpm exec` and PATH setup.
- Every later step imports from `domain/` and `config.ts`, so their shape must be fixed first.
- Layout follows `.tmp/omino-api` and `apps/factory-server/docs/BE_RULES.md`: `domain -> contracts -> application -> adapters -> bootstrap -> tests`. No barrel `index.ts`.

---

## 📦 Specification / Scope

- **Target**: `apps/factory/` (new package `@repo/factory`).
- **Classification**: `Universal Tooling` (CLI shell, pure domain).
- **Dependencies**:
  - `citty: catalog:` (CLI framework)
  - `zod: catalog:` (schemas, used by later steps)
  - `yaml: catalog:` (Line parsing, used by later steps)
  - `picocolors: catalog:` (table output, used by later steps)
  - devDependencies: `@types/node: catalog:`, `typescript: catalog:`, `vitest: catalog:`, `eslint: catalog:`, `@repo/eslint-config: workspace:*`, `@repo/typescript-config: workspace:*`
- **Bin name**: `factory-2`. `apps/cli` keeps `factory` until cut-over, so the two do not clash. The Supervisor runs the new flow as `factory-2` during manual checks. Cut-over is not planned yet.

---

## 🛠️ Implementation Plan

1. **Package files**
   - `apps/factory/package.json`: name `@repo/factory`, `type: module`, `private: true`, `bin: { "factory-2": "./src/cli.ts" }`, scripts `check-types`, `lint` (`eslint src test --max-warnings 0`), `test` (`vitest run`), `build` (`bun build src/cli.ts --outfile dist/factory.js --target bun`).
   - `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts` copied from `apps/operator-cli` pattern (no operator-specific rules).
2. **`src/config.ts`** (exported constants, one block):
   - `DEFAULT_FACTORY_URL = 'http://127.0.0.1:7070'`
   - `CLAIM_WAIT_MS = 25_000`
   - `HEARTBEAT_INTERVAL_MS = 10_000`
   - `SELF_FENCE_MS = 45_000`
   - `LEASE_TTL_MS = 60_000`
   - `MAX_BODY_BYTES = 1024 * 1024`
   - All values match `apps/factory-server/docs/PLAN.md` §3.7. Do not change them here.
3. **`src/domain/common/brand.ts`**: branded types `CellId`, `JobId`, `OrderId`, `IncidentId`, `PlanId`, `ProjectId`, each with a `toX(raw: string)` that returns the brand. No validation beyond non-empty.
4. **`src/domain/common/time.ts`**: `type EpochMs = number` and nothing else. No `Date.now()` here (domain has no clock).
5. **`src/domain/exit-codes.ts`**:
   - `export const EXIT = { ok: 0, refused: 1, argument: 2, unreachable: 3 } as const`
   - `export type ExitCode = (typeof EXIT)[keyof typeof EXIT]`
6. **`src/cli.ts`**:
   - citty root command `factory` with description and version.
   - No subcommands yet. `factory-2 --help` prints the root help.
   - Process exit uses `EXIT` codes.

---

## ✅ Acceptance Criteria

- [ ] `pnpm --filter @repo/factory check-types` passes.
- [ ] `factory-2 --help` runs and exits `0`.
- [ ] `config.ts` values match factory-server PLAN §3.7.
- [ ] `domain/` imports nothing from `application/`, `adapters/` or `bootstrap/`.
- [ ] No `any`; no `unknown` used as a type.
- [ ] No barrel `index.ts` anywhere in `apps/factory/src`.
- [ ] Declaration order in each file: constants, types, private helpers, exports.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md): `--help` output.
