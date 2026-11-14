---
scope: factory
summary: Lease and blob stores on Drizzle, plus export tar
why: Contracts pin fake and SQLite stores to one rule set; export needs no new dependency.
date: 2026-11-14
tags: [v2, storage, leases, blobs, export]
---

- **Rules live in core, bytes in the adapter.** `factory-core/src/blob-rules.ts` holds the STORAGE §5 limits, `BlobTooLargeError`, `fitBlob` (head + tail log truncation) and `blobRefsIn`.
  - Gzip, sha256 and the sweep age check stay in `factory-db`, because core is pure (no `crypto`, no clock, no `node:` imports).
- **Ports.** `LeaseStore.bootGrace(now, ttl)` sets every expiry to `now + ttl`. `BlobStore.sweep(now, referenced)` deletes unreferenced blobs created at or before `now - 24 h`.
  - The caller passes `referenced`; the store keeps no "referenced" flag. The SQLite side collects refs from event payloads with `referencedBlobs`.
- **Contract suites.** `defineLeaseStoreContract` and `defineBlobStoreContract` run against the fakes and against SQLite in memory and on a WAL file.
  - Core cannot hash, so the fake blob store takes `refOf` and the blob contract takes it as an argument.
- **Export format.** `export.factory.tar` is a ustar archive written and read by `factory-db/src/tar.ts`, with no new dependency.
  - Reads are strict: checksum, end marker, size, regular files only, and an allow-list of entry names.
- **Import.** Refuses a non-empty database. It inserts projects, blobs (re-hashed) and events with their original `global_seq`, then rebuilds `orders` through the injected project function, in one transaction.
  - `ExpireLease` is not appended here (v2-10).
- **Log fit before the hash.** `fitBlob` runs first in both `putBlobOn` (SQLite) and the fake `put`, so a log over 20 MiB is stored head + tail truncated and its ref must hash the stored bytes. A text over 2 MiB throws `BlobTooLargeError`.
- **Sweep reads the events itself.** `sqliteBlobStore.sweep` unions `referencedBlobs` with the caller's set, so a blob an event cites is never deleted, even if the caller passes an empty set.
- **Strict tar end.** `readTar` requires both zero end blocks and rejects trailing bytes; a truncated end marker throws.
- **Export fails on a missing blob.** A ref cited in an event payload with no stored row throws `cannot export`, so no archive imports with dangling events.
- **Not carried.** Blob `media_type` is not in the §7.3 layout, so imported blobs get `application/octet-stream`.
