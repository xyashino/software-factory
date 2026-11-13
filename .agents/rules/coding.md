---
trigger: always_on
description: "Coding rules"
---

## Coding

1. (A) Turbo minimal code
2. (A) Inline exports. Declaration order top to bottom, one block per kind, never interleaved: (1) constants (private and exported together, a constant that module-level code reads at load time goes above its reader), (2) types/interfaces, (3) private helper functions, (4) exported functions. No `const` / `interface` / `const` alternation.
3. (A) Never barrel export
