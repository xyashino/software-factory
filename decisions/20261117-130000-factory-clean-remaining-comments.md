---
scope: factory
summary: Remove the last spec and ADR references from production comments
why: Comments that cite spec sections or decisions paths go stale when the docs move.
date: 2026-11-17
tags: [factory, comments, hygiene]
---

- Production comments no longer carry spec section numbers or `decisions/` paths; an audit found only five comments left after the earlier cleanup.
- A JSDoc that restated its helper's name and signature is gone.
- No code, names, types or string literals changed; `v1` in route paths and `factory: v2` todo markers are behaviour, not provenance, and stay.
