---
scope: factory
summary: Move log blobs out of SQLite into blobs files
why: The database grew with every log, so backups and exports read a file that kept growing.
supersedes: 20261114-113924-factory-add-lease-blob-export
date: 2026-11-17
tags: [factory, storage, blobs, export, backup]
---

- Logs (`kind: 'log'`) are files `blobs/<sha256 hex>` beside `factory.db`. Migration 0003 adds `blob_files`, the metadata row of each file. Prompts, artifacts and handovers stay in `blobs`.
- `sqliteBlobStore(db, writer, gate, blobDir, clock)` routes by kind. `get`, `stat` and `sweep` see both stores.
- A log write goes to a `.tmp-` file, is fsynced, renamed to `blobs/<hex>`, and only then gets its row, in the same write section. A crash leaves an orphan file no row names.
- Sweep deletes unreferenced rows created at or before `now - 24 h`, with their files. Orphan and `.tmp-` files go too.
- A log is a blob an event cites as `logBlob`, or one over the 2 MiB text limit. Export and import need no new manifest field.
- Startup moves each stored log to a file in its own transaction, after its bytes hash to its ref. A mismatch keeps the row.
- Export reads logs from files. Import writes them back into an empty `blobs/` directory, and a failed import removes the files it wrote.
- Backup is `VACUUM INTO` plus a copy of `blobs/` into `<file>.blobs/`. A failed copy removes both.
- Q17 and STORAGE §5 are updated. The wire `blobPut` carries no kind yet, so Cells still send logs as text until it does.
