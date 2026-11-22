---
status: queued
priority: medium
line: standard
type: feat
depends_on: parent-slug
---

# <slug>: <short title>

## Objective

<1-2 sentences: what is built, fixed or refactored.>

## Context

<Why now. Verified facts with paths and numbers. Link `docs/<name>-plan.md` if part of an epic.>

## Scope

- **Target**: `<apps/x | packages/y | path>`
- **Classification**: `<Universal Tooling | Domain Core | Integration | Infrastructure | Web UI>`
- **Dependencies**: `<name: catalog:>`, `<@repo/name: workspace:*>`
- **Out of scope**: <what this todo must not touch>

## Verify first

<Claims not yet checked. Implementer confirms before coding. Delete section if empty.>

## Open decisions

<Choices the owner has not made, with the default taken. Delete section if empty.>

## Implementation Plan

1. **Files**: <create / modify / delete>
2. **Behavior**: <contracts, APIs, data flow>
3. **Integration**: <exports, consumers, wiring>

## Acceptance Criteria

- [ ] <explicit functional check>
- [ ] Tests: black box, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes.
