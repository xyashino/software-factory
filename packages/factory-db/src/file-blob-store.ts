import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** The temp prefix of a blob being written. A `.tmp-` file is never a stored blob. */
export const TMP_PREFIX = '.tmp-';

/**
 * Writes `bytes` as `dir/<hex>`, atomically: the bytes go to a temp file, which is fsynced and then
 * renamed over the final name. A crash before the rename leaves only a `.tmp-` file, so no reader
 * ever sees a partial blob behind its ref.
 */
export const writeBlobFile = (
  dir: string,
  hex: string,
  bytes: Uint8Array,
): void => {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${TMP_PREFIX}${hex}-${randomUUID()}`);
  try {
    writeFileSync(tmp, bytes, { flag: 'wx' });
    const fd = openSync(tmp, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, join(dir, hex));
  } catch (error) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw error;
  }
};

/** The stored bytes of `dir/<hex>`. Throws when the file is missing: a row with no file is a broken store. */
export const readBlobFile = (dir: string, hex: string): Uint8Array => {
  const path = join(dir, hex);
  if (!existsSync(path)) {
    throw new Error(`blob file ${path} is missing`);
  }
  return new Uint8Array(readFileSync(path));
};

/** Removes `dir/<hex>` when it exists. */
export const removeBlobFile = (dir: string, hex: string): void => {
  const path = join(dir, hex);
  if (existsSync(path)) unlinkSync(path);
};

/** The names of every entry in the blob directory; empty when the directory does not exist yet. */
export const listBlobFiles = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir) : [];
