---
scope: factory/runtime
summary: Remove four redundant doc comments from factory-runtime intake
why: Redundant comments restate code; spec and rationale comments stay
date: 2026-11-14
tags: [v2, trial, real-ai, comments]
---

- Todo `v2-trial-final-feature` removes redundant comments from `packages/factory-runtime/src/intake.ts`.
- Removed four single-line doc comments that restated the code under them: `putText`, `titleOf`, `specOf`, `claimed`.
- Kept every comment that cites a spec section (`PROTOCOL §`, `CORE §`) or states why the code is the way it is.
- No code, import, name or formatting changed; the diff is four deleted comment lines.
