---
status: todo
priority: medium
depends_on: []
line: feature
type: refactor
---

# Todo: Remove the `schemaVersion: 2` key from Lines

## 🎯 Objective

Remove `schemaVersion` from the Line schema, the JSON schema, every Line YAML and the fixtures in one change, so the schema and the files always agree.

---

## 🌐 Context & Problem Statement

`schemaVersion: 2` is a v2 marker on each Line file. Its only purpose is to label the schema generation, and the schema, the files and the tests must change together. A previous attempt removed it from the YAML only, so setup rejected every Line with `schemaVersion: must be 2`, and the Work order was cancelled.

---

## 📦 Specification / Scope

- **Target**: `packages/factory-definitions/src/line-schema.ts`, `packages/factory-definitions/schemas/line.schema.json`, `.factory/lines/*.yml`, `packages/factory-definitions/starter/.factory/lines/*.yml`, `packages/factory-definitions/src/__tests__/fixtures/valid/lines/feature.yml`.
- **Classification**: `Domain Core`
- **Dependencies**: none.

---

## 🛠️ Implementation Plan

1. Remove `schemaVersion` from `lineFileSchema` and from the JSON schema `required` list and `properties`.
2. Remove the `schemaVersion: 2` line from all six Line YAML files and the valid fixture.
3. Change the line tests so `schemaVersion` is refused as an unknown key, not required.

---

## ✅ Acceptance Criteria

- [ ] No `schemaVersion` appears in the Line schema, the JSON schema, the YAML files or the fixtures.
- [ ] A Line with `schemaVersion` is refused as an unknown key.
- [ ] `factory check` passes on `.factory/`.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Exactly one new `decisions/` entry for this change.
