---
scope: factory/operator-client
summary: Add operator client, exit-code map and file reader
why: Every verb needs one transport, one status-to-exit mapping and one file reader.
date: 2026-11-18
tags: [factory, operator, cli, exit-codes]
---

- New `apps/operator` package (`@repo/operator`), not `@repo/factory-operator-cli`, which clashes with legacy `apps/operator-cli`.
- `client.ts`: one `POST` per call to `FACTORY_OPERATOR_URL` with JSON `{ ...fields, token }`. Missing env or malformed URL is an argument error, sent nothing.
- Status map: `200` ok; `400`, `401`, `409`, `500` refused with reply `code` and `message`; any other status, timeout, network error, non-JSON or schema mismatch is unreachable.
- Timeout 10 s by default, injectable per call so tests use 200 ms.
- `exit-codes.ts`: `exitCodeFor` maps ok 0, refused 1, argument error 2, unreachable 3. `lineFor` prints `ok: true`, `code: message`, or message only.
- `files.ts`: reads UTF-8 file; `-` reads stdin; missing file, directory or unreadable stdin is an argument error.
- Token is never in printed lines or error text; error messages are fixed strings, fetch errors are not echoed.
- Tests: 30 pass (client integration against stub Cell, exit-code and file unit, boundary asserts). Stub Cell is `__tests__/stub-cell.ts`, `node:http` on 127.0.0.1.
- Boundary test: `apps/operator/src` imports no `apps/cell`, `apps/factory-server`, `packages/factory-*`; protocol has no `process`, `node:fs`, `node:net`.
- Gate green: check-types, lint, test for operator and operator-protocol; `nitpick:check`; `format:check`. Output in `.cell/steps/build/evidence`, not committed.
- Not in this step: `cli.ts`, `verbs/`, `usage.ts`, black-box CLI tests.
