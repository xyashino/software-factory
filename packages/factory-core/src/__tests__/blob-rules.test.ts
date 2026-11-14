import { describe, expect, it } from 'vitest';
import {
  BlobTooLargeError,
  GZIP_ABOVE_BYTES,
  LOG_MAX_BYTES,
  SWEEP_AGE_MS,
  TEXT_MAX_BYTES,
  blobRefsIn,
  fitBlob,
  limitOf,
  truncateLog,
} from '../blob-rules';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('blob size rules', () => {
  it('uses the STORAGE §5 numbers', () => {
    expect(TEXT_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(LOG_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(GZIP_ABOVE_BYTES).toBe(4 * 1024);
    expect(SWEEP_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(limitOf('text')).toBe(TEXT_MAX_BYTES);
    expect(limitOf('log')).toBe(LOG_MAX_BYTES);
  });

  it('returns a log within its limit unchanged', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(truncateLog(bytes, 10)).toBe(bytes);
  });

  it('cuts a log to exactly the limit, keeping head and tail around a marker', () => {
    const max = 200;
    const bytes = new TextEncoder().encode(
      'H'.repeat(100) + 'M'.repeat(500) + 'T'.repeat(100),
    );

    const cut = truncateLog(bytes, max);
    const text = decode(cut);

    expect(cut.byteLength).toBe(max);
    expect(text.startsWith('HHHH')).toBe(true);
    expect(text.endsWith('TTTT')).toBe(true);
    expect(text).toContain('bytes truncated');
    expect(text).not.toContain('MMMMMMMMMM');
  });

  it('refuses a text over 2 MiB and truncates a log over 20 MiB', () => {
    expect(() => fitBlob(new Uint8Array(TEXT_MAX_BYTES + 1), 'text')).toThrow(
      BlobTooLargeError,
    );
    expect(fitBlob(new Uint8Array(TEXT_MAX_BYTES), 'text').byteLength).toBe(
      TEXT_MAX_BYTES,
    );
    expect(fitBlob(new Uint8Array(LOG_MAX_BYTES + 5), 'log').byteLength).toBe(
      LOG_MAX_BYTES,
    );
  });

  it('collects every blob ref cited in a payload, once', () => {
    const ref = `sha256:${'a'.repeat(64)}`;
    const other = `sha256:${'b'.repeat(64)}`;
    const json = JSON.stringify({
      prompt: ref,
      logs: [ref, other],
      note: 'no ref',
    });

    expect([...blobRefsIn(json)].sort()).toEqual([ref, other].sort());
  });
});
