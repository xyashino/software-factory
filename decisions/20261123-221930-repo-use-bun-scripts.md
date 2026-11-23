---
scope: repo
summary: Run scripts and nitpick commands with bun
why: Package scripts invoked node directly and failed on missing nitpick binary in clean worktrees
date: 2026-11-23
---

- Update root `package.json` scripts to invoke `bun` instead of `node`.
- Add `nitpick`, `nitpick:check`, and `nitpick:sync` scripts running `bun packages/nitpick/dist/cli.js`.
- Update `scripts/prepare.mjs` to run `nitpick sync` via `bun packages/nitpick/dist/cli.js --sync`.
