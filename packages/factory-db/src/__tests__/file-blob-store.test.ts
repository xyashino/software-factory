import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listBlobFiles, readBlobFile, writeBlobFile } from '../file-blob-store';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

const blobDirIn = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-file-blobs-'));
  dirs.push(dir);
  return join(dir, 'blobs');
};

const HEX = 'a'.repeat(64);

describe('the file blob store', () => {
  it('leaves a written blob under its hash and no temp file beside it', () => {
    const dir = blobDirIn();

    writeBlobFile(dir, HEX, new TextEncoder().encode('a stored log'));

    expect(listBlobFiles(dir)).toEqual([HEX]);
    expect(new TextDecoder().decode(readBlobFile(dir, HEX))).toBe(
      'a stored log',
    );
  });

  it('refuses to read a blob whose file is missing', () => {
    expect(() => readBlobFile(blobDirIn(), HEX)).toThrow(/is missing/);
  });
});
