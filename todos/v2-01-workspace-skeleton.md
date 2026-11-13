---
status: todo
priority: high
depends_on: []
workflow: feature
---

# v2-01: Workspace skeleton and package boundaries

## Objective

Create the empty v2 workspace (four `apps/*`, three new `packages/*`) with working `check-types`,
`lint` and `test` scripts, and make the dependency rules of the design mechanically enforced before
any domain code exists.

## Read first

- `docs/README.md` (names), `docs/STRUCTURE.md` (whole file), `docs/RULES.md` §4
- `docs/ROADMAP.md` M0

## Scope (ROADMAP items)

`factory-m0-adr`, `factory-m0-workspace`, `factory-m0-boundaries`, `factory-m0-catalog`.

## Deliverables

1. `decisions/` entry recording the v2 architecture and linking to `docs/`.
2. `pnpm-workspace.yaml` includes `apps/*`.
3. Packages, each with `package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`,
   `check-types` / `lint` / `test` scripts and one smoke test:
   - `packages/factory-core` (`@repo/factory-core`), `packages/factory-db` (`@repo/factory-db`),
     `packages/factory-definitions` (`@repo/factory-definitions`)
   - `apps/server` (`@repo/factory-server`, bin `factory-server`), `apps/cell`
     (`@repo/factory-cell`, bin `factory-cell`), `apps/cli` (`@repo/factory-cli`, bin `factory`),
     `apps/operator-cli` (`@repo/factory-operator-cli`, bin `factory-operator`)
   - subpath `exports`, no `index.ts` barrels (STRUCTURE §1 conventions)
4. Each `package.json` lists only the workspace dependencies STRUCTURE §3 allows.
5. ESLint `no-restricted-imports` per package: `@repo/software-factory` everywhere in v2;
   `bun:*` / `node:*` in `factory-core`; `@repo/factory-core/cycle/*` in `apps/server`;
   `@repo/factory-db` and `@repo/factory-definitions` in `apps/cell`.
6. Purity test in `factory-core` scanning sources for `Date.now`, `Math.random`, `process.`,
   `fetch(`, `crypto` (pattern of v1 `src/engine/__tests__/purity.test.ts`).
7. Catalog additions `hono` and `fast-check`, each with its own `decisions/` entry.
8. Root `package.json` scripts `factory`, `factory-server`, `factory-cell` (stubs printing usage).

## Out of scope

Any domain type or logic. v1 (`packages/software-factory`) is not edited.

## Acceptance criteria

- `pnpm turbo check-types lint test` is green for the whole repo, v1 included.
- A fixture import of `@repo/software-factory` from a v2 package fails lint (tested).
- A fixture import of `bun:sqlite` in `factory-core` fails lint (tested).
