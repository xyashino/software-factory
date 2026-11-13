---
status: todo
priority: high
depends_on: [v2-07-storage-event-store]
workflow: feature
---

# v2-08: Storage — leases, blobs, export/import

## Objective

Complete `factory-db`: the lease store, the content-addressed blob store with size rules and sweep,
and the portable export/import format.

## Read first

- `docs/STORAGE.md` §2 (ports), §4 (`leases`, `blobs`), §5, §7
- `docs/PROTOCOL.md` §5 (lease numbers)

## Scope (ROADMAP items)

`factory-m3-leases-blobs`, `factory-m3-export`.

## Deliverables

1. `LeaseStore` (insert, extend for a Cell's jobs, expired(now), delete, `bootGrace(now, ttl)`),
   fake + SQLite, added to the contract suite.
2. `BlobStore` (put with hash verification, get, stat), gzip above 4 KiB, size limits (2 MiB text,
   20 MiB logs with head + tail truncation marker), daily sweep of blobs unreferenced after 24 h,
   fake + SQLite, contract tests.
3. Export writer and import reader for `export.factory.tar` (STORAGE §7.3): manifest, projects,
   events in `global_seq` order, referenced blobs; import into an empty database only.

## Out of scope

The admin CLI commands that call these (v2-10), appending `ExpireLease` after import (v2-10).

## Acceptance criteria

- Contract suite covers leases and blobs for fake and SQLite.
- Export → import round-trip test: identical events, blobs and rebuilt projection.
- `pnpm turbo check-types lint test` green.
