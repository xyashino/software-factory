---
scope: factory/hq
summary: Rename supervisor token to operator, keep old tokens working
why: The human token is called supervisor in code and on disk; the design names it operator. Old tokens and history must still work.
date: 2026-11-23
tags: [factory, hq, sf, rename, token, migration]
---

- Token kind, scopes, actor kind and incident triage owner `supervisor` -> `operator`. Scopes `operator:read`, `operator:write`. `admin:tokens` and `factory:*` unchanged.
- Migration `0007_operator_token_rename` rewrites in place: `safe_tokens.kind`, `safe_tokens.scopes_json`, `state_transitions.actor_kind`, `incidents.triage_owner`. Data-only UPDATEs, no table rebuild (no CHECK constraints).
- New tokens mint with prefix `sf_op_`. Old `sf_sup_` tokens still authenticate: auth checks the hash only, never the prefix. Stored `safe_tokens.prefix` values are history and stay.
- sf token file: `.factory-local/operator.token` is written and read first. Legacy `.factory-local/supervisor.token` is read only when it is the only token file. Never moved or deleted.
- Connection label and `fix:` hint name the file actually read (`repo:.factory-local/...`).
- sf `Access` kind and CLI `Mode` `supervisor` -> `operator`. Job role `operator` (station role) and the Cell process supervisor (`apps/sf/src/factory`) are unchanged.
- Web session tokens reuse the operator scopes and prefix.
- Rollback caveat: after `0007` runs, an older build drops `operator:*` scopes, so those tokens lose access. Not solved here; roll back only with a DB backup taken before upgrade.
- Blackbox test seeds a legacy token and history row, runs the migration SQL, and checks the old bearer still gets 200 on `GET /api/v1/projects` and the history row reads `operator`.
- Docs: `hq.md`, `sf.md`, `engineering.md`, `architecture.md`, `web-demo.md`, root `README.md`, `.nitpick` factory-install skill updated for token wording. The human role prose "Supervisor" in docs is not renamed.
