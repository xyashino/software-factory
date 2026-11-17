import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { eq, inArray, lte } from 'drizzle-orm';
import {
  type BlobKind,
  GZIP_ABOVE_BYTES,
  SWEEP_AGE_MS,
  blobRefsIn,
  fitBlob,
} from '@repo/factory-core/blob-rules';
import type { BlobRef } from '@repo/factory-core/ids';
import type { Clock } from '@repo/factory-core/ports/clock';
import type { BlobStore } from '@repo/factory-core/ports/blob-store';
import { type FactoryDatabase, drizzleOf } from './db';
import {
  listBlobFiles,
  readBlobFile,
  removeBlobFile,
  TMP_PREFIX,
  writeBlobFile,
} from './file-blob-store';
import { blobFiles, blobs, events } from './schema';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

const SHA256_PREFIX = 'sha256:';
const LOG_REF_FIELD = /"logBlob":"(sha256:[0-9a-f]{64})"/g;

/** `sha256:<hex>` of the bytes: the content address of a blob. */
export const blobRefOf = (bytes: Uint8Array): BlobRef =>
  `${SHA256_PREFIX}${createHash('sha256').update(bytes).digest('hex')}` as BlobRef;

/** The hex digest of a ref: the name of its file under `blobs/`. */
export const hexOf = (ref: BlobRef): string => ref.slice(SHA256_PREFIX.length);

/**
 * The refs an event payload (its JSON text) cites as a log: the `logBlob` of a command result or a
 * failure. Only logs are written as files; every other blob stays in SQLite.
 */
export const logRefsIn = (payloadJson: string): Set<BlobRef> =>
  new Set(
    [...payloadJson.matchAll(LOG_REF_FIELD)].map(
      (match) => match[1] as BlobRef,
    ),
  );

interface EncodedBlob {
  content: Uint8Array;
  encoding: 'identity' | 'gzip';
  size: number;
}

/**
 * The bytes to keep for a blob of `kind`: fitted to the kind's size rules, hashed to check `ref`, and
 * gzipped above `GZIP_ABOVE_BYTES`. `size` is the uncompressed length.
 */
const encodeBlob = (
  ref: BlobRef,
  bytes: Uint8Array,
  kind: BlobKind,
): EncodedBlob => {
  const stored = fitBlob(bytes, kind);
  if (blobRefOf(stored) !== ref) {
    throw new Error(`blob content does not hash to ${ref}`);
  }
  if (stored.byteLength > GZIP_ABOVE_BYTES) {
    return {
      content: gzipSync(stored),
      encoding: 'gzip',
      size: stored.byteLength,
    };
  }
  return { content: stored, encoding: 'identity', size: stored.byteLength };
};

export const decodeBlob = (content: Uint8Array, encoding: string): Uint8Array =>
  new Uint8Array(encoding === 'gzip' ? gunzipSync(content) : content);

/**
 * Writes one text blob row, synchronously, inside the caller's write section. Shared by `put` and
 * the import. A content address never changes, so a second put of the same ref is a no-op
 * (`ON CONFLICT DO NOTHING`).
 */
export const putBlobOn = (
  orm: FactoryDatabase,
  ref: BlobRef,
  bytes: Uint8Array,
  mediaType: string,
  kind: BlobKind,
  createdAt: number,
): void => {
  const encoded = encodeBlob(ref, bytes, kind);
  orm
    .insert(blobs)
    .values({
      ref,
      size: encoded.size,
      encoding: encoded.encoding,
      content: Buffer.from(encoded.content),
      mediaType,
      createdAt,
    })
    .onConflictDoNothing()
    .run();
};

/**
 * Stores one log blob as the file `blobs/<hex>` and its metadata row, in the caller's write section.
 * The file is written first (temp file, fsync, rename), then the row: a crash in between leaves an
 * orphan file that no row names, so no event can reach it. A ref already stored, in either table, is a no-op.
 */
export const putLogFileOn = (
  orm: FactoryDatabase,
  blobDir: string,
  ref: BlobRef,
  bytes: Uint8Array,
  mediaType: string,
  createdAt: number,
): void => {
  const stored =
    orm
      .select({ ref: blobs.ref })
      .from(blobs)
      .where(eq(blobs.ref, ref))
      .get() ??
    orm
      .select({ ref: blobFiles.ref })
      .from(blobFiles)
      .where(eq(blobFiles.ref, ref))
      .get();
  if (stored) return;
  const encoded = encodeBlob(ref, bytes, 'log');
  writeBlobFile(blobDir, hexOf(ref), encoded.content);
  orm
    .insert(blobFiles)
    .values({
      ref,
      size: encoded.size,
      encoding: encoded.encoding,
      mediaType,
      createdAt,
    })
    .onConflictDoNothing()
    .run();
};

/**
 * The uncompressed bytes of a stored blob, from the `blobs` table or from its file, or undefined when
 * the ref is not stored. A file row whose file is missing throws: the store is broken.
 */
export const readBlobOn = (
  orm: FactoryDatabase,
  blobDir: string,
  ref: BlobRef,
): Uint8Array | undefined => {
  const row = orm
    .select({ content: blobs.content, encoding: blobs.encoding })
    .from(blobs)
    .where(eq(blobs.ref, ref))
    .get();
  if (row) return decodeBlob(row.content, row.encoding);
  const file = orm
    .select({ encoding: blobFiles.encoding })
    .from(blobFiles)
    .where(eq(blobFiles.ref, ref))
    .get();
  if (!file) return undefined;
  return decodeBlob(readBlobFile(blobDir, hexOf(ref)), file.encoding);
};

/** Every blob ref cited by any stored event payload. The sweep keeps these. */
export const referencedBlobs = (orm: FactoryDatabase): Set<BlobRef> => {
  const cited = new Set<BlobRef>();
  for (const row of orm
    .select({ payload: events.payload })
    .from(events)
    .all()) {
    for (const ref of blobRefsIn(row.payload)) cited.add(ref);
  }
  return cited;
};

/**
 * The `BlobStore` over the `blobs` table and the `blobs/` directory. A log (`kind: 'log'`) is a file,
 * any other blob a row. `get`, `stat` and `sweep` see both. `created_at` is read from `clock`, so the
 * sweep's 24 h age is the Factory's clock, not the machine's, when a clock is given.
 */
export const sqliteBlobStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
  blobDir: string,
  clock: Clock = { now: () => Date.now() },
): BlobStore => {
  const orm = drizzleOf(db);
  return {
    put: (ref, bytes, mediaType = 'application/octet-stream', kind = 'text') =>
      gate.run(() => {
        writer.assertHeld();
        if (kind === 'log') {
          putLogFileOn(orm, blobDir, ref, bytes, mediaType, clock.now());
        } else {
          putBlobOn(orm, ref, bytes, mediaType, kind, clock.now());
        }
      }),
    get: (ref) => gate.read((reader) => readBlobOn(reader, blobDir, ref)),
    stat: (refs) =>
      gate.read((reader) => {
        const sizes = new Map<BlobRef, number>();
        if (refs.length === 0) return sizes;
        const ids = [...refs];
        for (const row of reader
          .select({ ref: blobs.ref, size: blobs.size })
          .from(blobs)
          .where(inArray(blobs.ref, ids))
          .all()) {
          sizes.set(row.ref as BlobRef, row.size);
        }
        for (const row of reader
          .select({ ref: blobFiles.ref, size: blobFiles.size })
          .from(blobFiles)
          .where(inArray(blobFiles.ref, ids))
          .all()) {
          sizes.set(row.ref as BlobRef, row.size);
        }
        return sizes;
      }),
    sweep: async (now, referenced) => {
      // The rows go in one write section; the files are unlinked after it commits, so a rolled-back
      // sweep never leaves a row without its file.
      const swept = await gate.run(() => {
        writer.assertHeld();
        // A blob some stored event cites is never swept, whatever the caller passed: the event scan is
        // the authority, and `referenced` can only protect more.
        const protectedRefs = new Set<BlobRef>([
          ...referencedBlobs(orm),
          ...referenced,
        ]);
        const cutoff = now - SWEEP_AGE_MS;
        const staleText = orm
          .select({ ref: blobs.ref })
          .from(blobs)
          .where(lte(blobs.createdAt, cutoff))
          .all()
          .map((row) => row.ref as BlobRef)
          .filter((ref) => !protectedRefs.has(ref));
        if (staleText.length > 0) {
          orm.delete(blobs).where(inArray(blobs.ref, staleText)).run();
        }
        const staleFiles = orm
          .select({ ref: blobFiles.ref })
          .from(blobFiles)
          .where(lte(blobFiles.createdAt, cutoff))
          .all()
          .map((row) => row.ref as BlobRef)
          .filter((ref) => !protectedRefs.has(ref));
        if (staleFiles.length > 0) {
          orm.delete(blobFiles).where(inArray(blobFiles.ref, staleFiles)).run();
        }
        // A file no row names is an orphan of a crashed write, or a temp file: no event can cite it.
        const named = new Set(
          orm
            .select({ ref: blobFiles.ref })
            .from(blobFiles)
            .all()
            .map((row) => hexOf(row.ref as BlobRef)),
        );
        const orphans = listBlobFiles(blobDir).filter(
          (name) => name.startsWith(TMP_PREFIX) || !named.has(name),
        );
        return {
          removed: [...staleText, ...staleFiles],
          files: [...staleFiles.map(hexOf), ...orphans],
        };
      });
      for (const hex of swept.files) removeBlobFile(blobDir, hex);
      return swept.removed;
    },
  };
};
