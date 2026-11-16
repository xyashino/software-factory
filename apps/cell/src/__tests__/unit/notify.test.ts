import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOTIFY_BODY_CHARS,
  NOTIFY_LOG,
  NOTIFY_TIMEOUT_MS,
  notifyQuietly,
  truncateBody,
} from '../../jobs/notify';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factory-cell-notify-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('notifyQuietly', () => {
  it('does nothing when notifications are off', async () => {
    await expect(
      notifyQuietly(undefined, dataDir, 'Delivered: todo-1'),
    ).resolves.toBeUndefined();
  });

  it('passes the title and options through unchanged', async () => {
    const notify = vi.fn(async () => undefined);

    await notifyQuietly(notify, dataDir, 'Question: todo-1', {
      body: 'Which branch?',
      sound: 'request',
    });

    expect(notify).toHaveBeenCalledWith('Question: todo-1', {
      body: 'Which branch?',
      sound: 'request',
    });
  });

  it('swallows a refused toast and writes the refusal to notify.log', async () => {
    const notify = vi.fn(async () => {
      throw new Error('herdr notification show failed');
    });

    await expect(
      notifyQuietly(notify, dataDir, 'Blocked: todo-1', { sound: 'request' }),
    ).resolves.toBeUndefined();

    const log = readFileSync(join(dataDir, NOTIFY_LOG), 'utf8');
    expect(log).toContain('"Blocked: todo-1"');
    expect(log).toContain('herdr notification show failed');
  });

  it('gives up on a toast that never returns, so no job waits on it', async () => {
    vi.useFakeTimers();
    try {
      const notify = vi.fn(() => new Promise<void>(() => undefined));
      const done = notifyQuietly(notify, dataDir, 'Delivered: todo-1', {
        sound: 'done',
      });

      await vi.advanceTimersByTimeAsync(NOTIFY_TIMEOUT_MS);

      await expect(done).resolves.toBeUndefined();
      expect(readFileSync(join(dataDir, NOTIFY_LOG), 'utf8')).toContain(
        'no answer',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('truncateBody', () => {
  it('keeps a short text whole, with its whitespace collapsed', () => {
    expect(truncateBody('  Which\n  branch?  ')).toBe('Which branch?');
  });

  it('cuts a long text to the body limit with an ellipsis', () => {
    const cut = truncateBody('x'.repeat(NOTIFY_BODY_CHARS + 50));

    expect(cut).toHaveLength(NOTIFY_BODY_CHARS);
    expect(cut.endsWith('…')).toBe(true);
  });
});
