import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openSeededStore } from './helpers';
import { sqliteJoinTokenStore } from '../join-tokens-table';
import { acquireWriter, type WriterLock } from '../writer-lock';

const locks: WriterLock[] = [];

afterEach(() => {
  for (const lock of locks) lock.release();
  locks.length = 0;
});

const setup = () => {
  const { db, store } = openSeededStore();
  const writer = acquireWriter(mkdtempSync(join(tmpdir(), 'factory-tokens-')));
  locks.push(writer);
  return { db, store, writer };
};

describe('join token store', () => {
  it('lists the tokens it created, never their hashes', async () => {
    const { db, store, writer } = setup();
    const tokens = sqliteJoinTokenStore(db, writer, store.gate);

    await tokens.create({
      joinTokenId: 'jt-1',
      tokenHash: 'hash-1',
      name: 'pool',
      createdAt: 10,
      expiresAt: null,
      commandId: 'cmd-1',
    });

    expect(await tokens.list()).toEqual([
      {
        joinTokenId: 'jt-1',
        name: 'pool',
        createdAt: 10,
        expiresAt: null,
        revokedAt: null,
      },
    ]);
  });

  it('keeps the first revocation time and reports unknown ids as not revoked', async () => {
    const { db, store, writer } = setup();
    const tokens = sqliteJoinTokenStore(db, writer, store.gate);
    await tokens.create({
      joinTokenId: 'jt-1',
      tokenHash: 'hash-1',
      name: 'pool',
      createdAt: 10,
      expiresAt: 99,
      commandId: 'cmd-1',
    });

    expect(await tokens.revoke('jt-1', 20)).toBe(true);
    expect(await tokens.revoke('jt-1', 30)).toBe(true);
    expect(await tokens.revoke('missing', 30)).toBe(false);
    expect((await tokens.list())[0]?.revokedAt).toBe(20);
  });

  it('knows which create commands already made a token', async () => {
    const { db, store, writer } = setup();
    const tokens = sqliteJoinTokenStore(db, writer, store.gate);
    await tokens.create({
      joinTokenId: 'jt-1',
      tokenHash: 'hash-1',
      name: 'pool',
      createdAt: 10,
      expiresAt: null,
      commandId: 'cmd-1',
    });

    expect(await tokens.createdForCommand('cmd-1')).toBe(true);
    expect(await tokens.createdForCommand('cmd-2')).toBe(false);
  });

  it('refuses a second token for the same command id at the table', async () => {
    const { db, store, writer } = setup();
    const tokens = sqliteJoinTokenStore(db, writer, store.gate);
    const record = {
      tokenHash: 'hash-1',
      name: 'pool',
      createdAt: 10,
      expiresAt: null,
      commandId: 'cmd-1',
    };
    await tokens.create({ ...record, joinTokenId: 'jt-1' });

    await expect(
      tokens.create({ ...record, joinTokenId: 'jt-2', tokenHash: 'hash-2' }),
    ).rejects.toThrow();
    expect((await tokens.list()).map((row) => row.joinTokenId)).toEqual([
      'jt-1',
    ]);
  });

  it('refuses a write once the writer lock is released', async () => {
    const { db, store, writer } = setup();
    const tokens = sqliteJoinTokenStore(db, writer, store.gate);
    writer.release();

    await expect(
      tokens.create({
        joinTokenId: 'jt-2',
        tokenHash: 'hash-2',
        name: 'late',
        createdAt: 1,
        expiresAt: null,
        commandId: 'cmd-2',
      }),
    ).rejects.toThrow();
  });
});
