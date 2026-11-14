import { describe, expect, it } from 'vitest';
import { readTar, writeTar } from '../tar';

const encoder = new TextEncoder();
const text = (value: string): Uint8Array => encoder.encode(value);

describe('the ustar archive', () => {
  it('reads back the entries it wrote, in order, with their bytes', () => {
    const entries = [
      { name: 'manifest.json', bytes: text('{"a":1}') },
      { name: 'empty.txt', bytes: new Uint8Array() },
      { name: 'blobs/' + 'a'.repeat(64), bytes: new Uint8Array(1500).fill(7) },
    ];

    const back = readTar(writeTar(entries));

    expect(back).toEqual(entries);
  });

  it('writes the same bytes for the same entries', () => {
    const entries = [{ name: 'x', bytes: text('same') }];
    expect(writeTar(entries)).toEqual(writeTar(entries));
  });

  it('refuses a corrupted header', () => {
    const archive = writeTar([{ name: 'x', bytes: text('payload') }]);
    archive[10] = archive[10]! ^ 0xff;

    expect(() => readTar(archive)).toThrow(/checksum/);
  });

  it('refuses an archive without its end marker', () => {
    const archive = writeTar([{ name: 'x', bytes: text('payload') }]);
    const cut = archive.subarray(0, archive.byteLength - 1024);

    expect(() => readTar(cut)).toThrow(/truncated/);
  });

  it('refuses an archive cut after its first end block', () => {
    const archive = writeTar([{ name: 'x', bytes: text('payload') }]);
    const cut = archive.subarray(0, archive.byteLength - 512);

    expect(() => readTar(cut)).toThrow(/end marker incomplete/);
  });

  it('refuses bytes after the complete end marker', () => {
    const archive = writeTar([{ name: 'x', bytes: text('payload') }]);
    const padded = new Uint8Array(archive.byteLength + 512);
    padded.set(archive, 0);
    padded.set(text('trailing'), archive.byteLength);

    expect(() => readTar(padded)).toThrow(/after its end marker/);
  });

  it('refuses an entry whose data is cut short', () => {
    const archive = writeTar([{ name: 'x', bytes: new Uint8Array(4000) }]);
    const cut = archive.subarray(0, 1024 + 100);

    expect(() => readTar(cut)).toThrow(/truncated/);
  });

  it('refuses a name longer than the ustar field', () => {
    expect(() =>
      writeTar([{ name: 'n'.repeat(101), bytes: text('x') }]),
    ).toThrow(/too long/);
  });
});
