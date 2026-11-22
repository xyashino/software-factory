---
scope: docs
summary: Fail CI on dead relative links in docs and READMEs
why: 19 dead links went unnoticed. A check stops doc rot after restructures.
date: 2026-11-22
tags: [docs, ci, links]
---

- Add `pnpm docs:check` (`scripts/check-doc-links.ts`): scans `docs/**`, root `README.md`, `apps/*/README.md` and `packages/*/README.md`, exits 1 and lists each `file -> link` whose relative target is missing.
- Skips external URLs, `mailto:` and `#anchor` links; strips `#anchor` before the file check.
- Ignores links inside code spans and fenced blocks, and does not scan `decisions/` or `todos/`.
- Add `pnpm docs:test`: black-box `node:test` suite on temp fixtures (pass, dead link, anchors, external, code, package readmes, skipped folders).
- Turbo tasks `//#docs:check` and `//#docs:test` run inside `pnpm ci:verify`.
- Root `package.json` gets `"type": "module"` so the `.ts` script runs without a module-type warning.
- No new dependencies: Node `fs` and `path` only.
