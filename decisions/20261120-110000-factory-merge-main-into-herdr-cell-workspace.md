---
scope: factory
summary: Merge main into the Herdr Cell workspace branch
why: main gained the Mechanic timeout and repair dir while this branch reworked the Herdr runner, and the two conflicted
date: 2026-11-20
tags: [v2, herdr, cell, mechanic, merge]
---

- `apps/factory/src/adapters/runners/herdr.ts`, `apps/factory/src/bootstrap/context.ts`, `apps/factory/test/unit/adapters/herdr-runner.test.ts`: kept the branch's version, the later evolution of the #144 Cell workspace (logs tab, loopback operator).
- `apps/factory/src/domain/line/parse-line.ts`: kept the branch's operator, workspace and deliver schema and added main's `mechanic.timeout` with `mechanicTimeoutMs`.
- Checks: factory and factory-server types, lint and tests pass; prettier check passes.
