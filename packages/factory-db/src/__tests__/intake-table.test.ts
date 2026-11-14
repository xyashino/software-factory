import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectId, TodoId } from '@repo/factory-core/ids';
import { sqliteIntakeStore } from '../intake-table';
import {
  acquireWriter,
  type WriterLock,
  WriterNotHeldError,
} from '../writer-lock';
import { openSeededStore } from './helpers';

const PROJECT = 'software-factory' as ProjectId;
const TODO = 'add-login' as TodoId;
const locks: WriterLock[] = [];

afterEach(() => {
  for (const lock of locks) lock.release();
  locks.length = 0;
});

const setup = () => {
  const { db, store } = openSeededStore();
  const writer = acquireWriter(mkdtempSync(join(tmpdir(), 'factory-intake-')));
  locks.push(writer);
  return { writer, intake: sqliteIntakeStore(db, writer, store.gate) };
};

describe('intake store', () => {
  it('keeps the last hash and diagnostic a todo was synced with', async () => {
    const { intake } = setup();
    await intake.upsert({
      projectId: PROJECT,
      todoId: TODO,
      contentHash: 'sha256:a',
      seenCommit: 'c1',
      diagnostic: null,
    });
    await intake.upsert({
      projectId: PROJECT,
      todoId: TODO,
      contentHash: 'sha256:b',
      seenCommit: 'c2',
      diagnostic: 'unparseable: missing frontmatter',
    });

    expect(await intake.get(PROJECT, TODO)).toEqual({
      projectId: PROJECT,
      todoId: TODO,
      contentHash: 'sha256:b',
      seenCommit: 'c2',
      diagnostic: 'unparseable: missing frontmatter',
    });
  });

  it('lists the rows of one project only', async () => {
    const { intake } = setup();
    await intake.upsert({
      projectId: PROJECT,
      todoId: TODO,
      contentHash: 'sha256:a',
      seenCommit: 'c1',
      diagnostic: null,
    });

    expect(await intake.forProject(PROJECT)).toHaveLength(1);
    expect(await intake.forProject('other' as ProjectId)).toEqual([]);
  });

  it('refuses a write without the writer lock', async () => {
    const { writer, intake } = setup();
    writer.release();

    await expect(
      intake.upsert({
        projectId: PROJECT,
        todoId: TODO,
        contentHash: 'sha256:a',
        seenCommit: 'c1',
        diagnostic: null,
      }),
    ).rejects.toThrow(WriterNotHeldError);
  });
});
