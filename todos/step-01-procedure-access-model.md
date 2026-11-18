---
status: todo
factory: v2
plan: factory-procedure-core
priority: high
line: feature
type: refactor
---

# Todo: `step-01-procedure-access-model` — One Factory For Procedure Access

## 🎯 Objective

Replace the separate `publicProcedure` / `scopedProcedure` / `anyScopedProcedure` implementations in factory-server with one `define` factory that takes an access rule, and make every procedure export an object (`{ access, contract, execute }`) instead of a bare function. Behaviour of existing endpoints must not change.

---

## 🌐 Context & Problem Statement

- `apps/factory-server/src/application/core/procedure.ts` has three helpers that each repeat the handler type and the `withZodSchema(contract)(handler)` wiring.
- `Procedure` is a bare function `(raw, ctx) => Promise<ProcedureResponse>`. The adapter cannot see the contract or the access rule without calling the procedure.
- Scope checks already exist and must be kept: all-of (`scopedProcedure`, `authorize`) and any-of (`anyScopedProcedure`).
- Target shape: one private `checkAccess` owns authorization, and `ContextFor<A>` gives handlers `AuthenticatedContext` for every non-public rule.
- Existing call sites look like `scopedProcedure(['supervisor:write'])(contract)((input, ctx) => ...)`. They must compile without edits.

---

## 📦 Specification / Scope

- **Target**:
  - `apps/factory-server/src/application/core/procedure.ts`
- **Boundary**: `apps/factory-server/src/application/core/` only. Handlers, routes and contracts stay unchanged in this step.
- **Classification**: no new tests in this step. Behaviour is pinned by `step-03` black-box tests; this step is checked by `check-types` and the existing suite.
- **Public surface after this step**:
  - `type Access = { kind: 'public' } | { kind: 'all'; scopes: readonly TokenScope[] } | { kind: 'any'; scopes: readonly TokenScope[] }`
  - `type Procedure = { readonly access: Access; readonly contract: ZodContract; execute(raw: RawInput, ctx: TransportContext): Promise<ProcedureResponse> }`
  - Exports kept with the same names and call shapes: `publicProcedure(contract)(handler)`, `scopedProcedure(scopes)(contract)(handler)`, `anyScopedProcedure(scopes)(contract)(handler)`, `authenticatedProcedure(contract)(handler)`.
- **Forbidden messages must stay byte-identical**:
  - all-of: `Token lacks scope: ${missing.join(', ')}`
  - any-of: `Token needs one of: ${allowedScopes.join(', ')}`
- **Dependencies**: none added.

---

## 🛠️ Implementation Plan

1. **Constants and types first**, in this order (repo export-order rule): `Access`, `ContextFor<A>`, `Procedure` type.
2. **Private helpers**:
   - `authenticate(ctx)` stays as it is.
   - `checkAccess<A extends Access>(access, ctx): Promise<ContextFor<A>>`:
     - `public` returns `ctx` cast to `ContextFor<A>`. This is the only cast for the public path.
     - otherwise call `authenticate`, compute all-of or any-of with `switch (access.kind)` and a `never` default (ts-exhaustive), throw the exact `Forbidden` message for the rule, and return `{ ...ctx, principal }` cast to `ContextFor<A>`.
   - Keep the casts inside `checkAccess` only.
3. **Private `define`**: `define(access)(contract)(handler)` returns `{ access, contract, execute }`. `execute` calls `withZodSchema(contract)(handler)` with `checkAccess(access, ctx)` as the context. Do not cast in `define`.
4. **Exports** (inline `export const`, after the private helpers):
   - `publicProcedure = define({ kind: 'public' })`
   - `scopedProcedure = (scopes) => define({ kind: 'all', scopes })`
   - `anyScopedProcedure = (scopes) => define({ kind: 'any', scopes })`
   - `authenticatedProcedure = scopedProcedure([])`
5. **Check** that `withZodSchema` still type-checks with a generic context. Adjust its generic only if needed.

---

## ✅ Acceptance Criteria

- [ ] `publicProcedure`, `scopedProcedure`, `anyScopedProcedure`, `authenticatedProcedure` keep their names and call shapes.
- [ ] Every procedure export is an object with `access`, `contract` and `execute`.
- [ ] The two `Forbidden` messages are byte-identical to the current ones.
- [ ] Handlers under `scopedProcedure` and `authenticatedProcedure` see `AuthenticatedContext`; `ctx.principal` type-checks without a cast.
- [ ] Casts appear only in `checkAccess`.
- [ ] No barrel file added; no `any`; no `unknown` used as a type.
- [ ] `pnpm --filter @repo/factory-server-v2 check-types`, `lint` and `test` pass.
- [ ] One new ADR entry in `decisions/`, per [decision-log](.agents/rules/decision-log.md).
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md).
