import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import type { BlobRef } from '@repo/factory-core/ids';
import type { BlobStore } from '@repo/factory-core/ports/blob-store';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

/** `sha256:<hex>` of the bytes: the content address of a blob (STORAGE §4, `blobs`). */
export const blobRefOf = (bytes: Uint8Array): BlobRef =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}` as BlobRef;

/**
 * The `BlobStore` over the `blobs` table (identity encoding). `put` verifies that the bytes hash to
 * the ref it is given and is idempotent (`INSERT OR IGNORE`): a content address never changes.
 */
export const sqliteBlobStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): BlobStore => ({
  put: (ref, bytes, mediaType = 'application/octet-stream') =>
    gate.run(() => {
      writer.assertHeld();
      if (blobRefOf(bytes) !== ref) {
        throw new Error(`blob content does not hash to ${ref}`);
      }
      db.run(
        `INSERT OR IGNORE INTO blobs (ref, size, encoding, content, media_type, created_at)
         VALUES (?, ?, 'identity', ?, ?, ?)`,
        [ref, bytes.byteLength, bytes, mediaType, Date.now()],
      );
    }),
  get: (ref) =>
    gate.run(() => {
      const row = db
        .query<{ content: Uint8Array }, [string]>(
          'SELECT content FROM blobs WHERE ref = ?',
        )
        .get(ref);
      return row ? new Uint8Array(row.content) : undefined;
    }),
  stat: (refs) =>
    gate.run(() => {
      const sizes = new Map<BlobRef, number>();
      const statement = db.query<{ size: number }, [string]>(
        'SELECT size FROM blobs WHERE ref = ?',
      );
      for (const ref of refs) {
        const row = statement.get(ref);
        if (row) sizes.set(ref, row.size);
      }
      return sizes;
    }),
});
