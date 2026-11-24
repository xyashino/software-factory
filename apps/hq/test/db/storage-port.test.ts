import { describe, expect, it } from 'vitest';
import { createSqliteStorageAdapter } from '../../src/adapters/storage/sqlite-storage.adapter';
import type {
  ProjectInsert,
  StorageWriteTx,
} from '../../src/application/ports/storage.port';
import { asProjectId } from '../../src/domain/common/brand';
import { createTestDb } from '../support/test-db';

const PROJECT: ProjectInsert = {
  projectId: asProjectId('proj-1'),
  repoUrl: 'git@example.test:acme/factory.git',
  defaultBaseBranch: 'main',
  maxRunning: 5,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const insertProject = (tx: StorageWriteTx): void => {
  tx.projects.insert(PROJECT);
};

describe('storage port', () => {
  it('write commits all changes when callback returns', async () => {
    const storage = createSqliteStorageAdapter(createTestDb());

    await storage.write(insertProject);
    const projects = await storage.read((tx) => tx.projects.list());

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ projectId: 'proj-1' });
  });

  it('write rolls back every change when callback throws', async () => {
    const storage = createSqliteStorageAdapter(createTestDb());

    await expect(
      storage.write((tx) => {
        insertProject(tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const projects = await storage.read((tx) => tx.projects.list());

    expect(projects).toEqual([]);
  });

  it('dry-run write returns callback result and leaves no rows', async () => {
    const storage = createSqliteStorageAdapter(createTestDb());

    const result = await storage.write(
      (tx) => {
        insertProject(tx);
        return 'previewed';
      },
      { dryRun: true },
    );
    const projects = await storage.read((tx) => tx.projects.list());

    expect(result).toBe('previewed');
    expect(projects).toEqual([]);
  });
});
