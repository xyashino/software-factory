# `operator` — Implementation Rules (`IMPLEMENTATION_RULES.md`)

Source of truth for code shape, layering, and testing in `apps/operator`. `PLAN.md` says what the
CLI does; this file says how the code is written. When a todo diverges from this file on code
shape, this file wins.

---

## 1. Scope & Isolation

1. **Thin client only.** The CLI parses arguments, reads files named by options, sends one request
   to `FACTORY_OPERATOR_URL`, and prints the reply. It holds no Line rules, no state machine, and no
   factory credentials (PLAN §1, §5).
2. **No runner or agent knowledge.** `apps/operator/src/` MUST NOT import from `apps/cell`,
   `apps/factory-server`, `apps/server`, `apps/worker`, `apps/operator-cli`, or any `packages/factory-*`.
   Herdr, headless, Claude, and any other runner or agent stay in the Cell (`apps/cell/src/runners/`).
3. **Shared wire shape only.** Verb contracts live in `packages/operator-protocol`. The CLI and the
   Cell both import it. It holds schemas and constants only, never rules.
4. **Catalog dependencies only.** Third-party packages are pinned with `catalog:` in
   `pnpm-workspace.yaml` (`citty`, `zod`, `vitest`, `typescript`, `eslint`, `@types/node`).
5. **Localhost only.** The client talks only to the URL in `FACTORY_OPERATOR_URL`. It never reads
   `FACTORY_CYCLE_TOKEN` from a file and never writes either variable to disk or logs.

---

## 2. Directory Layout & Dependency Direction

```text
apps/operator/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── vitest.config.ts
├── docs/                          # PLAN.md, IMPLEMENTATION_RULES.md
└── src/
    ├── cli.ts                     # citty root command; registers verbs by explicit import
    ├── usage.ts                   # help text per command
    ├── client.ts                  # POST one request; maps HTTP status -> outcome
    ├── exit-codes.ts              # 0 ok, 1 refused, 2 bad args/env/file, 3 unreachable
    ├── files.ts                   # --feedback, --handover, --report; "-" reads stdin
    ├── verbs/
    │   ├── define-verb.ts         # defineVerb({ name, args, readFiles, toRequest })
    │   ├── operator/              # done, verdict, block, context
    │   └── mechanic/              # read, answer, incident
    └── __tests__/
```

- `packages/operator-protocol/src/` holds `constants.ts`, `replies.ts`, and `verbs/*.contract.ts`.
- Dependency direction, strict: `cli.ts` -> `verbs/` -> `files.ts`, `client.ts`, `exit-codes.ts`,
  `packages/operator-protocol`. `client.ts` and `files.ts` never import `verbs/`.
- Nothing imports `cli.ts`.

---

## 3. Code Style & TypeScript (Repo-Wide Rules)

1. **No barrel files.** Never create an `index.ts` that only re-exports. Import concrete paths.
   The only entrypoint file is `src/cli.ts`.
2. **Declaration order** in every `.ts` file, top to bottom, one block per kind, never interleaved:
   1. constants,
   2. types and interfaces,
   3. private helper functions,
   4. exported functions and verbs.
   A constant read at load time goes above its reader.
3. **Arrow functions only.** `const fn = (...) => ...`. No `function` declarations.
4. **Strict types.** No `any`. No `as unknown as`. Narrow with Zod, discriminated unions, or type
   guards. Exhaustive `switch` on every union, ending in a `never` check.
5. **Minimal comments.** Only a non-obvious why (a constraint or workaround). Never narrate code.
   No task or step references.
6. **Text output is minimal.** CLI output is one line on success (`ok: true`) and `code: message`
   on refusal. Do not add banners or progress text.

---

## 4. Verb Rules

1. **One verb = one file** in `verbs/operator/` or `verbs/mechanic/`. Each file calls `defineVerb`
   once and exports the result.
2. **`defineVerb` owns the pipeline:** parse args with the verb's Zod schema, read the files declared
   in `readFiles`, build the request with `toRequest`, then hand it to `client.ts`. A verb file
   contains no I/O of its own.
3. **Syntactic checks only in the CLI:** a flag is present, an enum value is one of its options, a
   required file is readable, `-` means stdin. Any check that depends on the Line, the job state, the
   epoch, or the step list is the server's job (PLAN §5). Do not duplicate it.
4. **Role is not checked in the CLI.** The Cell maps the token to a role and rejects a verb the role
   cannot use. The CLI must still send the verb it was asked to send and let the Cell refuse it.
5. **Read-only verbs** (`context`, `read`) never send a checkpoint flag and never change the request
   shape to mutate. The Cell decides whether they checkpoint.
6. **Report and handover files** are read as UTF-8 text and sent as the file content in the
   request body. The CLI never sends the file path to the server.
7. **Unknown options are an error.** Extra fields are rejected before sending. The Cell and the server
   also reject extra fields with `400 invalid` (factory-server PLAN §11.4).

---

## 5. Client, Transport & Errors

1. **One request per invocation.** `POST /` with JSON body `{ verb, ...fields, token }`.
2. **Transport behind `client.ts` only.** If the endpoint moves from loopback TCP to a Unix socket
   (PLAN §8 item 4), only `client.ts` changes.
3. **Status -> exit code mapping** is in one place (`exit-codes.ts`):
   - `200` -> `0`, print `ok: true`.
   - `400`, `401`, `409`, `500` -> `1`, print `code: message` from the reply.
   - connection refused, timeout, or unreadable reply -> `3`.
   - missing env var, missing file, bad args -> `2`, before any request.
4. **Error text names the rule** that refused the verb, as the server sends it (factory-server PLAN §11.4). The CLI
   adds no wording of its own on refusal.
5. **Secrets never printed.** The token is never echoed, even in error output or debug text.

---

## 6. Protocol Package (`packages/operator-protocol`)

1. Every verb has one contract: `body` schema plus its reply schemas for `200`, `400`, `401`, `409`,
   `500`. The same contract is used by the CLI (to build the request) and the Cell (to parse it).
2. Schemas use `.strict()` so an extra field is rejected on both sides.
3. Constants (`MAX_BODY_BYTES = 1 MiB`, verb names, role names, reply codes) live in
   `constants.ts` only.
4. No logic beyond schema construction. No file I/O, no network, no `process.env`.

---

## 7. Testing

1. **Three tiers:**
   - **Unit:** `verbs/define-verb.ts`, `files.ts`, `exit-codes.ts`, and the protocol contracts.
     Pure functions, no network.
   - **Integration:** `client.ts` against the stub Cell (`__tests__/stub-cell.ts`), a local HTTP
     server that answers each status code.
   - **Black-box:** `cli.ts` run as a process or through its entry function against the stub Cell.
     Assert on exit code and output only.
2. **Test names are short user stories**, AAA layout, no Gherkin, no internal mocks of `client.ts`.
3. **`boundaries.test.ts` must assert:**
   - no file under `apps/operator/src/` imports from `apps/cell`, `apps/factory-server`, or
     `packages/factory-*`,
   - no file under `packages/operator-protocol/src/` imports `process`, `node:fs`, or `node:net`.
4. **Every exit code in PLAN §4 has a test.** `0`, `1`, `2`, and `3` each have at least one black-box
   case.

---

## 8. Verification Gate

Before a change is complete, from the repo root:

```bash
pnpm --filter @repo/factory-operator-cli check-types
pnpm --filter @repo/factory-operator-cli lint
pnpm --filter @repo/factory-operator-cli test
pnpm --filter @repo/operator-protocol check-types
pnpm --filter @repo/operator-protocol test
pnpm nitpick:check
pnpm format:check
```

Package names must match the `package.json` names in use at that time. Rename the filter if the
package is renamed (see PLAN §9).

Each change also adds exactly one ADR entry in `decisions/` and records evidence per
`.agents/skills/evidence/SKILL.md`.
