---
scope: docs
summary: Add dead relative doc link check to CI
why: 19 dead links went unnoticed; restructures need a gate
date: 2026-11-22
tags: [docs, ci]
---

- `scripts/check-doc-links.ts`: scans `docs/**/*.md`, root `README.md`, `apps/*/README.md`, `packages/*/README.md`; exit 1 listing `file -> link`.
- Checks only relative file links; skips external schemes, `/` absolute, pure `#anchor`; strips `#anchor` before the file check.
- Ignores links inside fenced code blocks and inline code spans.
- `decisions/` and `todos/` not scanned (historical, may link removed files).
- Root scripts: `docs:check`, `docs:test` (node:test black-box, fixture repos), `scripts:check-types` (strict tsc).
- `turbo.json`: `//#docs:check`, `//#docs:test`, `//#scripts:check-types`; all three in `ci:verify`.
- Root devDeps added: `@repo/typescript-config`, `@types/node`, `typescript` (catalog). No runtime deps.
- `scripts/package.json` sets `"type": "module"` for `.ts` scripts only; root unchanged.
- `packages/nitpick/README.md` untouched: its `[id](id.md)` is inside backticks, now ignored.
- Planted dead link fails the check; clean repo passes. `pnpm ci:verify` exit 0.
