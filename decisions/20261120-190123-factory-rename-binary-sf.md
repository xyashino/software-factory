---
scope: factory
summary: Rename v2 binary to sf and resolve operator command at runtime
why: Operator command hardcoded src/cli.ts, which breaks in dist bundles and compiled binaries
date: 2026-11-20
tags: [v2, cli, binary, operator, cell]
---

- Bin `factory-2` -> `sf`; build outfile `dist/factory.js` -> `dist/sf.js`; `meta.name` `factory` -> `sf`.
- `CLI_ENTRY` removed from `config.ts`; `operatorCommandOf()` added below the constants.
  - Compiled binary (basename not `bun` / `bun.exe`): `<execPath> operator`.
  - Bun script: `bun <running entry> operator`, entry from `process.argv[1]`.
- Cell `run-job` prompt uses `operatorCommandOf()` instead of `bun ${CLI_ENTRY} operator`.
- Blackbox `cli-help` describe renamed to `sf entrypoint`; asserts stdout names `sf`.
- New unit `test/unit/config.test.ts` covers compiled, dev and dist modes via injected runtime.
- Checks: factory tests, lint, check-types and prettier pass; `nitpick:check` runs with this entry.
