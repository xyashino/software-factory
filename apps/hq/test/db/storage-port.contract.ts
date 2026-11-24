import { expect, it } from 'vitest';
import type {
  JobInsert,
  ProjectInsert,
  StoragePort,
  StorageWriteTx,
  WorkOrderInsert,
} from '../../src/application/ports/storage.port';
import {
  asCellId,
  asFactoryId,
  asJobId,
  asOrderId,
  asProjectId,
} from '../../src/domain/common/brand';

const SEED_AT = 1_700_000_000_000;
const FACTORY_ID = asFactoryId('factory-1');
const UNIQUE_VIOLATION =
  /UNIQUE constraint failed|duplicate key value violates unique constraint/i;

const PROJECT: ProjectInsert = {
  projectId: asProjectId('proj-1'),
  repoUrl: 'git@example.test:acme/factory.git',
  defaultBaseBranch: 'main',
  maxRunning: 5,
  createdAt: SEED_AT,
  updatedAt: SEED_AT,
};

const insertProject = async (tx: StorageWriteTx): Promise<void> => {
  await tx.projects.insert(PROJECT);
};

const workOrder = (
  orderId: string,
  extra: Partial<WorkOrderInsert> = {},
): WorkOrderInsert => ({
  orderId: asOrderId(orderId),
  projectId: PROJECT.projectId,
  slug: orderId,
  title: orderId,
  type: 'feat',
  description: 'seeded order',
  lineName: 'feature',
  unavailableLineFactoriesJson: [],
  priority: 'medium',
  baseBranch: 'main',
  branch: `factory/${orderId}`,
  state: 'queued',
  version: 1,
  createdAt: SEED_AT,
  updatedAt: SEED_AT,
  ...extra,
});

const activeJob = (
  jobId: string,
  orderId: string,
  cellId: string,
): JobInsert => ({
  jobId: asJobId(jobId),
  projectId: PROJECT.projectId,
  orderId: asOrderId(orderId),
  claimedByCellId: asCellId(cellId),
  claimedByFactoryId: FACTORY_ID,
  kind: 'run_operator',
  workspaceMode: 'fresh',
  status: 'claimed',
  repoUrl: PROJECT.repoUrl,
  baseBranch: 'main',
  targetBranch: 'factory/order',
  expectedPriorStepsJson: [],
  payloadJson: {},
  createdAt: SEED_AT,
});

const readyMechanicJob = (jobId: string): JobInsert => ({
  jobId: asJobId(jobId),
  projectId: PROJECT.projectId,
  kind: 'mechanic',
  workspaceMode: 'reuse',
  status: 'ready',
  repoUrl: PROJECT.repoUrl,
  baseBranch: 'main',
  targetBranch: 'factory/mechanic',
  expectedPriorStepsJson: [],
  payloadJson: {},
  claimedByFactoryId: FACTORY_ID,
  createdAt: SEED_AT,
});

const seedWorld = async (tx: StorageWriteTx): Promise<void> => {
  await insertProject(tx);
  await tx.factories.insert({
    factoryId: FACTORY_ID,
    name: 'factory one',
    lastSeenAt: SEED_AT,
    createdAt: SEED_AT,
  });
  await tx.orders.insert(workOrder('order-1'));
  await tx.orders.insert(workOrder('order-2'));
};

const messageChain = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause =
    error.cause === undefined ? '' : ` ${messageChain(error.cause)}`;
  return `${error.message}${cause}`;
};

const rejectionMessage = async (action: Promise<unknown>): Promise<string> => {
  try {
    await action;
  } catch (error) {
    return messageChain(error);
  }
  return 'resolved';
};

export const storagePortContract = (
  makeStorage: () => Promise<StoragePort>,
): void => {
  it('write commits all changes when callback returns', async () => {
    // Arrange
    const storage = await makeStorage();

    // Act
    await storage.write(insertProject);
    const projects = await storage.read((tx) => tx.projects.list());

    // Assert
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ projectId: 'proj-1' });
  });

  it('write rolls back every change when callback throws', async () => {
    // Arrange
    const storage = await makeStorage();

    // Act
    await expect(
      storage.write(async (tx) => {
        await insertProject(tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const projects = await storage.read((tx) => tx.projects.list());

    // Assert
    expect(projects).toEqual([]);
  });

  it('dry-run write returns callback result and leaves no rows', async () => {
    // Arrange
    const storage = await makeStorage();

    // Act
    const result = await storage.write(
      async (tx) => {
        await insertProject(tx);
        return 'previewed';
      },
      { dryRun: true },
    );
    const projects = await storage.read((tx) => tx.projects.list());

    // Assert
    expect(result).toBe('previewed');
    expect(projects).toEqual([]);
  });

  it('rejects a second active job for the same order', async () => {
    // Arrange
    const storage = await makeStorage();
    await storage.write(seedWorld);
    await storage.write((tx) =>
      tx.jobs.insert(activeJob('job-1', 'order-1', 'cell-1')),
    );

    // Act
    const second = storage.write((tx) =>
      tx.jobs.insert(activeJob('job-2', 'order-1', 'cell-2')),
    );

    // Assert
    expect(await rejectionMessage(second)).toMatch(UNIQUE_VIOLATION);
  });

  it('rejects a second active job for the same cell', async () => {
    // Arrange
    const storage = await makeStorage();
    await storage.write(seedWorld);
    await storage.write((tx) =>
      tx.jobs.insert(activeJob('job-1', 'order-1', 'cell-1')),
    );

    // Act
    const second = storage.write((tx) =>
      tx.jobs.insert(activeJob('job-2', 'order-2', 'cell-1')),
    );

    // Assert
    expect(await rejectionMessage(second)).toMatch(UNIQUE_VIOLATION);
  });

  it('rejects a second active order for the same cell', async () => {
    // Arrange
    const storage = await makeStorage();
    await storage.write(seedWorld);
    await storage.write((tx) =>
      tx.orders.update(asOrderId('order-1'), {
        state: 'running',
        activeCellId: asCellId('cell-1'),
      }),
    );

    // Act
    const second = storage.write((tx) =>
      tx.orders.update(asOrderId('order-2'), {
        state: 'running',
        activeCellId: asCellId('cell-1'),
      }),
    );

    // Assert
    expect(await rejectionMessage(second)).toMatch(UNIQUE_VIOLATION);
  });

  it('lets exactly one of two concurrent claims win a ready job', async () => {
    // Arrange
    const storage = await makeStorage();
    await storage.write(async (tx) => {
      await seedWorld(tx);
      await tx.jobs.insert(readyMechanicJob('job-ready'));
    });
    const claim = (cellId: string) =>
      storage.write(async (tx) => {
        const job = await tx.jobs.findReadyMechanic(FACTORY_ID);
        if (job === undefined) return null;
        return tx.jobs.update(job.jobId, {
          status: 'claimed',
          claimedByCellId: asCellId(cellId),
        });
      });

    // Act
    const outcomes = await Promise.all([claim('cell-a'), claim('cell-b')]);

    // Assert
    expect(outcomes.filter((outcome) => outcome !== null)).toHaveLength(1);
  });
};
