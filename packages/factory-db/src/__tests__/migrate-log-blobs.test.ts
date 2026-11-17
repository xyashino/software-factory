import { describe, expect, it } from 'vitest';
import { TEXT_MAX_BYTES } from '@repo/factory-core/blob-rules';
import type { BlobRef } from '@repo/factory-core/ids';
import { drizzleOf } from '../db';
import { listBlobFiles } from '../file-blob-store';
import { migrateLogBlobs } from '../migrate-log-blobs';
import { blobFiles, blobs, events } from '../schema';
import { blobRefOf, hexOf, putBlobOn } from '../sqlite-blob-store';
import { openSeededStore, scratchBlobDir } from './helpers';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A row as the store held it before logs became files: identity-encoded, in the `blobs` table. */
const legacyRow = (
  db: ReturnType<typeof openSeededStore>['db'],
  ref: BlobRef,
  content: Uint8Array,
  createdAt: number,
): void => {
  drizzleOf(db)
    .insert(blobs)
    .values({
      ref,
      size: content.byteLength,
      encoding: 'identity',
      content: Buffer.from(content),
      mediaType: 'text/plain',
      createdAt,
    })
    .run();
};

/** An event whose payload cites `ref` as a command's log, as the Cell reports it. */
const citeAsLog = (
  db: ReturnType<typeof openSeededStore>['db'],
  ref: BlobRef,
): void => {
  drizzleOf(db)
    .insert(events)
    .values({
      globalSeq: 1,
      orderId: 'move-log-blobs-to-files:order:1',
      seq: 1,
      at: 0,
      actor: JSON.stringify({ kind: 'cell', cellId: 'cell-1' }),
      commandId: 'command-1',
      epoch: null,
      schemaVersion: 1,
      type: 'command_completed',
      payload: JSON.stringify({ logBlob: ref }),
    })
    .run();
};

describe('moving stored logs to files', () => {
  it('moves a log over the text limit to a file and drops its row', () => {
    const { db } = openSeededStore();
    const log = new Uint8Array(TEXT_MAX_BYTES + 1).fill(97);
    const ref = blobRefOf(log);
    legacyRow(db, ref, log, 5);
    const blobDir = scratchBlobDir();

    const result = migrateLogBlobs(db, blobDir);

    expect(result).toEqual({ moved: 1, kept: [] });
    expect(listBlobFiles(blobDir)).toEqual([hexOf(ref)]);
    expect(drizzleOf(db).select().from(blobs).all()).toEqual([]);
    expect(drizzleOf(db).select().from(blobFiles).all()).toEqual([
      expect.objectContaining({
        ref,
        size: log.byteLength,
        encoding: 'identity',
        createdAt: 5,
      }),
    ]);
  });

  it('moves a small log that an event names as its logBlob', () => {
    const { db } = openSeededStore();
    const log = encode('a small inspection log');
    const ref = blobRefOf(log);
    legacyRow(db, ref, log, 0);
    citeAsLog(db, ref);
    const blobDir = scratchBlobDir();

    expect(migrateLogBlobs(db, blobDir).moved).toBe(1);
    expect(listBlobFiles(blobDir)).toEqual([hexOf(ref)]);
  });

  it('keeps a small text blob that no event names as a log', () => {
    const { db } = openSeededStore();
    const prompt = encode('a prompt, kept in SQLite');
    const ref = blobRefOf(prompt);
    putBlobOn(drizzleOf(db), ref, prompt, 'text/markdown', 'text', 0);
    const blobDir = scratchBlobDir();

    expect(migrateLogBlobs(db, blobDir)).toEqual({ moved: 0, kept: [] });
    expect(drizzleOf(db).select().from(blobs).all()).toHaveLength(1);
    expect(listBlobFiles(blobDir)).toEqual([]);
  });

  it('keeps a log whose bytes do not hash to its ref', () => {
    const { db } = openSeededStore();
    const ref = blobRefOf(encode('the bytes the ref names'));
    const damaged = new Uint8Array(TEXT_MAX_BYTES + 1).fill(120);
    legacyRow(db, ref, damaged, 0);
    const blobDir = scratchBlobDir();

    expect(migrateLogBlobs(db, blobDir)).toEqual({ moved: 0, kept: [ref] });
    expect(drizzleOf(db).select().from(blobs).all()).toHaveLength(1);
    expect(listBlobFiles(blobDir)).toEqual([]);
  });

  it('does nothing on a second run', () => {
    const { db } = openSeededStore();
    const log = new Uint8Array(TEXT_MAX_BYTES + 1).fill(98);
    legacyRow(db, blobRefOf(log), log, 0);
    const blobDir = scratchBlobDir();
    migrateLogBlobs(db, blobDir);

    expect(migrateLogBlobs(db, blobDir)).toEqual({ moved: 0, kept: [] });
    expect(listBlobFiles(blobDir)).toHaveLength(1);
  });
});
