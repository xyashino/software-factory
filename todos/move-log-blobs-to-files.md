---
status: todo
priority: medium
depends_on: [mechanic-own-tab]
plan: herdr-tabs-and-log-files
---

# Todo: Move log blobs out of SQLite into a content-addressed directory

## 🎯 Objective

Store large log blobs (inspection and setup output) as files under `blobs/<sha256>` behind the existing `BlobStore` port, so the SQLite database stops growing with logs.

---

## 🌐 Context & Problem Statement

Every blob lives in the `blobs` table of the SQLite database (`packages/factory-db/src/schema.ts`, `packages/factory-db/src/sqlite-blob-store.ts`). Logs make up most of the data, and referenced blobs are kept forever. The database therefore grows with every inspection run, which slows backups (the online backup and export both read the whole file) and makes the single file large to copy.

The design already anticipates this move. `docs/STORAGE.md` §5 says log blobs move "to a directory or object store behind the same `BlobStore` port", and `docs/OPEN-QUESTIONS.md` Q17 lists it as the later step. Q17 currently records **In SQLite** as the decision, so this todo must supersede it.

Without the move, the cost grows with every cycle: quality-gate and setup logs are the largest and most frequent blobs.

---

## 📦 Specification / Scope

- **Target**: `packages/factory-db/src/` (blob store, schema, export and archive), `docs/STORAGE.md`, `docs/OPEN-QUESTIONS.md`
- **Classification**: `Infrastructure`
- **Dependencies**:
  - `@repo/factory-core: workspace:*` (the `BlobStore` port and the `blob-rules` ref scan are unchanged)

Scope decision (confirm before implementing): move **logs only** (Q17 wording, the bulk of the data), or **all blobs** (prompts, artifacts and handovers too). This todo assumes logs only; prompts and artifacts stay in SQLite.

Out of scope: an object store (S3 and similar), and any change to the `/v1/blobs/:ref` wire routes.

---

## 🛠️ Implementation Plan

1. **Add a file-backed `BlobStore`**:
   - New adapter next to `sqlite-blob-store.ts`, writing `blobs/<sha256>` under the data directory.
   - Keep the port's methods (`put`, `get`, `stat`, `sweep`) and the gzip rule (above 4 KiB).
   - Write to a temp file and rename, so a crash never leaves a half-written blob.
2. **Route logs to the file store**: the server picks the store per blob kind (log vs other) through the port. Prompts and artifacts keep using SQLite.
3. **Keep references valid**: `stat` and `sweep` must see both stores, and `sweep` deletes only unreferenced files older than 24 h.
4. **Backup, export and archive**: `export-import.ts` and `archive.ts` must copy the blob directory with the database. Import into an empty database restores both.
5. **Migration**: move existing log rows from the `blobs` table into files on first start, with a verify step (hash matches the ref) before deleting the rows. Do it in one transaction per blob.
6. **Docs and decisions**: update `docs/STORAGE.md` §4–5 and set Q17 to the new decision. Write one `decisions/` entry that supersedes the Q17 decision.

---

## ✅ Acceptance Criteria

- [ ] A log blob is written as `blobs/<sha256>` and its event stores only the ref.
- [ ] `stat`, `get` and `sweep` behave the same for file-backed and SQLite-backed blobs.
- [ ] A crash during a write never leaves a partial file behind a valid ref.
- [ ] Export and import restore the blob directory with the database; an event never points at a missing blob after restore.
- [ ] Existing log rows migrate to files, each verified by hash before its row is deleted.
- [ ] `docs/STORAGE.md` §5 and Q17 match the implementation.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Exactly one new `decisions/` entry that supersedes the Q17 decision.
