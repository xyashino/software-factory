import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CellId } from '@repo/factory-core/ids';
import { openSeededStore } from './helpers';
import { sqliteCellStore } from '../cells-table';
import { sqliteJoinTokenStore } from '../join-tokens-table';
import { sqliteSupervisorTokenStore } from '../supervisor-tokens-table';
import { acquireWriter, type WriterLock } from '../writer-lock';

const CELL = '01J0000000000000000000000W' as CellId;
const locks: WriterLock[] = [];

afterEach(() => {
  for (const lock of locks) lock.release();
  locks.length = 0;
});

const setup = () => {
  const { db, store } = openSeededStore();
  const writer = acquireWriter(mkdtempSync(join(tmpdir(), 'factory-creds-')));
  locks.push(writer);
  return { db, gate: store.gate, writer };
};

const issueJoinToken = async (
  tokens: ReturnType<typeof sqliteJoinTokenStore>,
  expiresAt: number | null = null,
) => {
  await tokens.create({
    joinTokenId: 'jt-1',
    tokenHash: 'join-hash',
    name: 'pool',
    createdAt: 10,
    expiresAt,
    commandId: 'cmd-1',
  });
};

describe('join token lookup by hash', () => {
  it('finds a live token by its hash', async () => {
    const { db, gate, writer } = setup();
    const tokens = sqliteJoinTokenStore(db, writer, gate);
    await issueJoinToken(tokens);

    expect(await tokens.findActive('join-hash', 100)).toEqual({
      tokenHash: 'join-hash',
      joinTokenId: 'jt-1',
    });
    expect(await tokens.findActive('other-hash', 100)).toBeUndefined();
  });

  it('does not find a revoked token', async () => {
    const { db, gate, writer } = setup();
    const tokens = sqliteJoinTokenStore(db, writer, gate);
    await issueJoinToken(tokens);
    await tokens.revoke('jt-1', 50);

    expect(await tokens.findActive('join-hash', 100)).toBeUndefined();
  });

  it('does not find a token at or after its expiry', async () => {
    const { db, gate, writer } = setup();
    const tokens = sqliteJoinTokenStore(db, writer, gate);
    await issueJoinToken(tokens, 200);

    expect(await tokens.findActive('join-hash', 199)).toMatchObject({
      joinTokenId: 'jt-1',
    });
    expect(await tokens.findActive('join-hash', 200)).toBeUndefined();
  });
});

describe('cell credentials', () => {
  it('enrolls a Cell under its credential hash and finds it there', async () => {
    const { db, gate, writer } = setup();
    const tokens = sqliteJoinTokenStore(db, writer, gate);
    await issueJoinToken(tokens);
    const cells = sqliteCellStore(db, writer, gate);

    await cells.join({
      cellId: CELL,
      name: 'cell-a',
      credentialHash: 'cred-hash',
      joinedWith: 'jt-1',
      at: 20,
    });

    expect(await cells.findByCredentialHash('cred-hash')).toMatchObject({
      credentialHash: 'cred-hash',
      record: { cellId: CELL, name: 'cell-a', revokedAt: null },
    });
    expect(await cells.findByCredentialHash('unknown')).toBeUndefined();
  });

  it('keeps a revoked Cell findable so the caller can refuse it', async () => {
    const { db, gate, writer } = setup();
    const tokens = sqliteJoinTokenStore(db, writer, gate);
    await issueJoinToken(tokens);
    const cells = sqliteCellStore(db, writer, gate);
    await cells.join({
      cellId: CELL,
      name: 'cell-a',
      credentialHash: 'cred-hash',
      joinedWith: 'jt-1',
      at: 20,
    });
    await cells.revoke(CELL, 30);

    expect(await cells.findByCredentialHash('cred-hash')).toMatchObject({
      record: { revokedAt: 30 },
    });
  });
});

describe('supervisor token store', () => {
  it('finds the row of a stored hash and nothing else', async () => {
    const { db, gate, writer } = setup();
    const tokens = sqliteSupervisorTokenStore(db, writer, gate);

    await tokens.create({ tokenHash: 'sup-hash', name: 'dev', createdAt: 5 });

    expect(await tokens.find('sup-hash')).toEqual({
      tokenHash: 'sup-hash',
      name: 'dev',
    });
    expect(await tokens.find('plain-token')).toBeUndefined();
  });
});
