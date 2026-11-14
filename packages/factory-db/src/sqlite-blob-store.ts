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
import { blobs, events } from './schema';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

/** `sha256:<hex>` of the bytes: the content address of a blob (STORAGE §4, `blobs`). */
export const blobRefOf = (bytes: Uint8Array): BlobRef =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}` as BlobRef;

/**
 * Writes one blob row, synchronously, inside the caller's write section. The bytes are fitted to the
 * size rules of `kind` (`fitBlob`: a log is truncated, an oversized text is refused), must hash to
 * `ref` once fitted, gzip above `GZIP_ABOVE_BYTES`, and are idempotent (`ON CONFLICT DO NOTHING`): a
 * content address never changes. Shared by `put` and the import.
 */
export const putBlobOn = (
  orm: FactoryDatabase,
  ref: BlobRef,
  bytes: Uint8Array,
  mediaType: string,
  kind: BlobKind,
  createdAt: number,
): void => {
  const stored = fitBlob(bytes, kind);
  if (blobRefOf(stored) !== ref) {
    throw new Error(`blob content does not hash to ${ref}`);
  }
  const gzipped = stored.byteLength > GZIP_ABOVE_BYTES;
  orm
    .insert(blobs)
    .values({
      ref,
      size: stored.byteLength,
      encoding: gzipped ? 'gzip' : 'identity',
      content: Buffer.from(gzipped ? gzipSync(stored) : stored),
      mediaType,
      createdAt,
    })
    .onConflictDoNothing()
    .run();
};

/** The uncompressed bytes of a stored blob, or undefined when the ref is not stored. */
export const readBlobOn = (
  orm: FactoryDatabase,
  ref: BlobRef,
): Uint8Array | undefined => {
  const row = orm
    .select({ content: blobs.content, encoding: blobs.encoding })
    .from(blobs)
    .where(eq(blobs.ref, ref))
    .get();
  if (!row) return undefined;
  return new Uint8Array(
    row.encoding === 'gzip' ? gunzipSync(row.content) : row.content,
  );
};

/** Every blob ref cited by any stored event payload. The sweep keeps these (STORAGE §5). */
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
 * The `BlobStore` over the `blobs` table (STORAGE §4, §5). `created_at` is read from `clock`, so the
 * sweep's 24 h age is the Factory's clock, not the machine's, when a clock is given.
 */
export const sqliteBlobStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
  clock: Clock = { now: () => Date.now() },
): BlobStore => {
  const orm = drizzleOf(db);
  return {
    put: (ref, bytes, mediaType = 'application/octet-stream', kind = 'text') =>
      gate.run(() => {
        writer.assertHeld();
        putBlobOn(orm, ref, bytes, mediaType, kind, clock.now());
      }),
    get: (ref) => gate.run(() => readBlobOn(orm, ref)),
    stat: (refs) =>
      gate.run(() => {
        const sizes = new Map<BlobRef, number>();
        if (refs.length === 0) return sizes;
        const rows = orm
          .select({ ref: blobs.ref, size: blobs.size })
          .from(blobs)
          .where(inArray(blobs.ref, [...refs]))
          .all();
        for (const row of rows) sizes.set(row.ref as BlobRef, row.size);
        return sizes;
      }),
    sweep: (now, referenced) =>
      gate.run(() => {
        writer.assertHeld();
        // A blob some stored event cites is never swept, whatever the caller passed: the event scan is
        // the authority, and `referenced` can only protect more (STORAGE §5).
        const protectedRefs = new Set<BlobRef>([
          ...referencedBlobs(orm),
          ...referenced,
        ]);
        const stale = orm
          .select({ ref: blobs.ref })
          .from(blobs)
          .where(lte(blobs.createdAt, now - SWEEP_AGE_MS))
          .all()
          .map((row) => row.ref as BlobRef)
          .filter((ref) => !protectedRefs.has(ref));
        if (stale.length > 0) {
          orm.delete(blobs).where(inArray(blobs.ref, stale)).run();
        }
        return stale;
      }),
  };
};
