import type { Database } from 'bun:sqlite';
import { eq } from 'drizzle-orm';
import { TEXT_MAX_BYTES } from '@repo/factory-core/blob-rules';
import type { BlobRef } from '@repo/factory-core/ids';
import { drizzleOf } from './db';
import { writeBlobFile } from './file-blob-store';
import { blobFiles, blobs, events } from './schema';
import { blobRefOf, decodeBlob, hexOf, logRefsIn } from './sqlite-blob-store';

export interface LogBlobMigration {
  /** Log rows moved from the `blobs` table to files. */
  moved: number;
  /** Log rows whose bytes do not hash to their ref. They stay in the table, untouched. */
  kept: BlobRef[];
}

/**
 * Moves the stored logs from the `blobs` table to `blobs/<hex>` files, the first time the store is
 * opened with this code. A row is a log when an event cites it as `logBlob`, or when it is over the
 * text limit (only a log can be that large). Each row is verified first: its bytes must hash to its
 * ref, or the row is kept. A verified row moves in one transaction: the file is written, its metadata
 * row inserted, the `blobs` row deleted, then the commit. A re-run finds no log rows and does nothing.
 *
 * Runs on the writer connection, before the store is served; the caller holds the writer lock.
 */
export const migrateLogBlobs = (
  db: Database,
  blobDir: string,
): LogBlobMigration => {
  const orm = drizzleOf(db);
  const logRefs = new Set<BlobRef>();
  for (const row of orm
    .select({ payload: events.payload })
    .from(events)
    .all()) {
    for (const ref of logRefsIn(row.payload)) logRefs.add(ref);
  }

  const result: LogBlobMigration = { moved: 0, kept: [] };
  const rows = orm.select().from(blobs).all();
  for (const row of rows) {
    const ref = row.ref as BlobRef;
    if (!logRefs.has(ref) && row.size <= TEXT_MAX_BYTES) continue;
    if (blobRefOf(decodeBlob(row.content, row.encoding)) !== ref) {
      result.kept.push(ref);
      continue;
    }
    // raw: one transaction per blob, so a failure leaves every other blob as it was (STORAGE §5).
    db.exec('BEGIN IMMEDIATE');
    try {
      writeBlobFile(blobDir, hexOf(ref), row.content);
      orm
        .insert(blobFiles)
        .values({
          ref,
          size: row.size,
          encoding: row.encoding,
          mediaType: row.mediaType,
          createdAt: row.createdAt,
        })
        .onConflictDoNothing()
        .run();
      orm.delete(blobs).where(eq(blobs.ref, ref)).run();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    result.moved += 1;
  }
  return result;
};
