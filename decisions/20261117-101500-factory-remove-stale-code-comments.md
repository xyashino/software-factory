---
scope: factory
summary: Remove spec refs, provenance and noise comments from production code
why: Comments cited spec sections, a removed v1 package and restated types; they go stale when docs move and break the minimal-comments rule.
date: 2026-11-17
tags: [factory, comments, hygiene]
---

- Production `.ts` comments in `factory-core`, `factory-definitions`, `factory-db`, `factory-runtime` and the cli, cell, server apps no longer cite `§` spec sections or `CORE`, `PROTOCOL`, `STORAGE`, `ROADMAP`, `RULES` links.
- v1 provenance ("ported from", "as v1 did", `publishBlockedWork` history) is removed; each comment keeps only the behaviour it explains.
- JSDoc on internal helpers is removed, or rewritten as a short `//` constraint comment when it records a non-obvious constraint.
- No code, names, types or string literals changed: token streams of every touched file match `HEAD`. String literals such as `/v1/` routes, `factory: v2` and usage text stay as they are.
- The `coding-minimal-comments` rule itself is unchanged.
