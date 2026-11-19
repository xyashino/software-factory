---
scope: factory
summary: Use the name operator instead of operator-cli in todo specs
why: The operator app is named apps/operator. Todo specs still said operator-cli, which does not match the target names.
date: 2026-11-18
tags: [factory, operator, todos, naming]
---

- `cli-01`, `cli-07` and `remove-v1-software-factory` now refer to `apps/operator` instead of `apps/operator-cli`.
- `operator-client` directories are unchanged; they are a separate name.
- No code written.
