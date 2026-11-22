# contracts plan

## Goal

Stop hand-copying wire contracts. One source per API, imported by server and clients. Plus one pure kit for contract types and client reply parsing.

## Verified facts

- `apps/cell/.../schema/types.ts` and `apps/factory/.../schema/types.ts` byte-identical. `errorResponse` in both `contracts/common.ts` same except trailing blank line.
- Factory contracts: 9 files + `common.ts`. Imports from factory domain: `order-state` (states, priorities, actions, plan states/actions), `common/events` (`ACTOR_KINDS`, `ENTITY_TYPES`), `incidents/incident-rules`. Import count: 30 src + 4 test files use `contracts/`.
- Cell contracts: 5 files + `common.ts` (`errorResponse` only). Domain imports: `RUNTIME_STATUSES` (`domain/cells/cell-slot`), `RUNNERS` (`domain/settings/preferences`). 14 src + 1 test.
- sf `contracts/` mirrors FACTORY API: `cells.contract.ts` has enroll/hello/claim/heartbeat/drain/leave/list/revoke, same as factory. It does NOT combine cell API. (Earlier claim "sf cells.contract combines two APIs" was wrong.)
- sf `contracts/common.ts` (127 lines) redefines factory enums + error replies. Drift risk: new factory state not added in sf, no compile error.
- sf `workOrderDto` identical to factory. Diff sizes sf vs factory: projects 2 lines, stream 3, work-orders 31, tokens 38, incidents 40, order-plans 43, queue 47, jobs 84, cells 152 (not yet classified: import-only or real drift).
- sf calls cell-server (`/api/v1/factories`, etc.) with raw route strings via `ctx.cellServer`. No cell contracts used. So cell-contracts for sf = new typing, not dedupe.
- sf `mapReply` returns unvalidated body, maps error status to `Refused` / `Unauthorized` / `Unreachable`. Does not validate against contract.
- web-demo imports zero contracts. Own `lib/factory-schemas.ts` (13 `z.object`) = likely third copy. Not compared.
- sf `operator.contract.ts` is the only operator contract. The orphaned operator app and protocol package were retired by `operator-retire-app-and-protocol`.
- `apps/sf/test/unit/contracts/drift.test.ts` already compares sf contract field names with factory contracts (crude). Goes away with the sf copies.
- No rule forbids the `factory-` prefix in package names. The only match was the operator boundaries test (`FORBIDDEN_PACKAGE`, bans operator imports of `@repo/factory*`), removed with `apps/operator`. Names `@repo/factory-contracts` and `@repo/cell-contracts` stand.
- `apps/cell/eslint.config.mjs` `LEGACY` rule bans cell imports of `@repo/factory-*` and `@repo/cell-*`. `@repo/cell-contracts` matches it, so the `cell-contracts-package` step must change that rule.

## Decisions

- `@repo/zod-contract-kit`: pure. Contract types, shared field schemas, `errorResponse`, `parseReply`. No Hono, no `BaseError`, no server runtime. `withZodSchema` stays server-side (goes to future `server-kit`).
- `@repo/factory-contracts`, `@repo/cell-contracts`: schemas + enums only. Server is source of truth; on drift sf follows factory.
- Wire enums move from app domain into contracts package. Domain imports from package (right direction). Domain logic stays in app.
- Naming `*-contracts`. The old operator protocol package is retired, not renamed.
- No barrel. Subpath exports `"./*": "./src/*.ts"`.
- Contracts carry no method/path. Route-typed client = out of scope.

## Order and split

| Todo | What | Depends on |
| --- | --- | --- |
| `zod-contract-kit-package` | Create kit, swap `schema/types.ts` in cell + factory | none |
| `factory-contracts-package` | Create package, move contracts + enums, factory switches | kit |
| `sf-adopt-factory-contracts` | Classify drift, sf drops its copies | factory-contracts |
| `web-demo-adopt-factory-contracts` | Evaluate + replace `factory-schemas.ts` | factory-contracts |
| `cell-contracts-package` | Create package, move contracts + enums, cell switches | kit |
| `sf-adopt-cell-contracts` | sf validates cell-server replies | cell-contracts |

Each todo = one ADR when done. Package todos stay separate from sf switch: sf step carries drift risk and 28 files.

Whole order with sqlite kit (see [`bun-sqlite-kit-plan.md`](./bun-sqlite-kit-plan.md)): bun-sqlite-kit (factory, cell), server-kit (todo not written yet), zod-contract-kit, factory-contracts, cell-contracts. No contracts todo needs server-kit.

## Risks

- `HttpStatus` union in kit = superset of factory (401 403 422) and cell (502). Cell `ProcedureResponse` becomes wider. Accept, or add generic param.
- Moving enums out of `order-state.ts`: file may mix constants with transition logic (not read). Move constants only.
- Real drift found in sf diff = existing client/server bug. Report it, do not silently pick.
- Large import churn: 30+4 factory files, 14+1 cell, 18+10 sf. Mechanical; verify with `bun run ci:verify`.

## Follow-ups (no todo yet)

- `parseReply` adoption in sf `mapReply` and web-demo `factory-client` (replace hand error parsing).
- `jscpd` run for clones that file names miss.
- Route-typed contracts (`{ method, path }`).

## Verify

`bun run ci:verify` per todo.
