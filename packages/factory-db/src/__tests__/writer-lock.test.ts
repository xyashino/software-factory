import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireWriter,
  LOCK_FILE_NAME,
  WriterHeldError,
  WriterNotHeldError,
} from '../writer-lock';

const HOLDER = fileURLToPath(
  new URL('./fixtures/hold-writer.ts', import.meta.url),
);

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factory-lock-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** Starts a holder process and waits until it reports it holds the lock. */
const startHolder = async (dir: string) => {
  const child = Bun.spawn(['bun', HOLDER, dir], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('held') && !text.includes('refused')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value);
  }
  reader.releaseLock();
  return { child, out: text };
};

describe('writer lock', () => {
  it('creates the data directory with mode 0700 and a lock file', () => {
    const lock = acquireWriter(dataDir);
    try {
      expect(statSync(join(dataDir, LOCK_FILE_NAME)).isFile()).toBe(true);
      expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    } finally {
      lock.release();
    }
  });

  it('refuses a second acquire in the same process while the first is held', () => {
    const first = acquireWriter(dataDir);
    try {
      expect(() => acquireWriter(dataDir)).toThrow(WriterHeldError);
    } finally {
      first.release();
    }
  });

  it('lets the directory be taken again after release', () => {
    const first = acquireWriter(dataDir);
    first.release();
    const second = acquireWriter(dataDir);
    expect(second.held).toBe(true);
    second.release();
  });

  it('rejects a write once released, and release is idempotent', () => {
    const lock = acquireWriter(dataDir);
    lock.release();
    lock.release();
    expect(() => lock.assertHeld()).toThrow(WriterNotHeldError);
  });

  it('refuses a second process at once while the first holds the lock', async () => {
    const holder = await startHolder(dataDir);
    try {
      expect(holder.out).toContain('held');
      const started = performance.now();
      const refused = await startHolder(dataDir);
      const elapsed = performance.now() - started;
      expect(refused.out).toContain('refused');
      expect(await refused.child.exited).toBe(3);
      expect(elapsed).toBeLessThan(5_000);
    } finally {
      holder.child.kill('SIGKILL');
      await holder.child.exited;
    }
  });

  it('is released when the holder is killed, so a third process gets it', async () => {
    const holder = await startHolder(dataDir);
    holder.child.kill('SIGKILL');
    await holder.child.exited;

    const third = await startHolder(dataDir);
    try {
      expect(third.out).toContain('held');
    } finally {
      third.child.kill('SIGKILL');
      await third.child.exited;
    }
  });
});
