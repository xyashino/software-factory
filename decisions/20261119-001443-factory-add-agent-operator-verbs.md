---
scope: factory
summary: Add factory operator verbs for agents in a Cell job
why: Agents in a job need one client that reports only to their own Cell, with syntax checks and no retries.
date: 2026-11-19
tags: [factory, cli, operator, cell]
---

- `factory operator done`, `verdict pass`, `verdict fail --feedback <file>`, `block --reason <why> --handover <file>`, `context`, `read`, `incident --action <action> [--step <id>] --diagnosis --outcome --report <file>`.
- One `POST` to `FACTORY_OPERATOR_URL` with `{verb, ...fields, token}` and `Authorization: Bearer <token>`. No retries.
- Reads only `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN`. Never `.factory/`, `FACTORY_TOKEN` or the token file.
- Exit 2, nothing sent: missing env, missing or invalid flag, `--action` outside the five values, `--step` missing for `restart_from_step`, unknown option, unreadable file.
- Exit 0: reply `200`. Prints `ok: true`; `context` and `read` print the reply JSON.
- Exit 1: reply `400`, `401`, `409` or `500`. Prints `code: message` to stderr.
- Exit 3: unreachable Cell, unreadable reply, or any other status.
- `--feedback`, `--handover`, `--report` send file text, never a path. `-` reads stdin.
- Token is sent in body and header only. Never printed.
- Unknown options are refused because citty drops them silently.
- Open verbs `answer`, `tell`, `ask` are not built.
- Procedures are thin senders over `OperatorClientPort`. The token lives only in the HTTP adapter.
- `factory-operator` shim still runs `apps/operator-cli`. Not changed here.
