import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  asCellId,
  asOrderId,
  asProjectId,
  asFactoryId,
  asJobId,
} from '../../src/domain/common/brand';
import { createDb, type Db } from '../../src/db/client';
import { jobs } from '../../src/db/schema/jobs';
import { projects } from '../../src/db/schema/projects';
import { workOrders } from '../../src/db/schema/orders';
import { FACTORY_ID, FACTORY_TOKEN, seedFactory } from './factory-session';

const SEED_AT = 1_700_000_000_000;

export const createTestDb = (): Db => createDb(':memory:');

export const createTempDbPath = (): string =>
  join(mkdtempSync(join(tmpdir(), 'factory-server-')), 'factory.db');

export const seedBaseline = (db: Db): void => {
  const projectId = asProjectId('proj-1');
  db.insert(projects)
    .values({
      projectId,
      repoUrl: 'git@example.test:acme/factory.git',
      defaultBaseBranch: 'main',
      maxRunning: 5,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .run();
  seedFactory(db, FACTORY_ID, FACTORY_TOKEN, SEED_AT);
  for (const id of ['order-1', 'order-2']) {
    db.insert(workOrders)
      .values({
        orderId: asOrderId(id),
        projectId,
        slug: id,
        title: id,
        type: 'feat',
        description: 'seeded order',
        lineName: 'feature',
        unavailableLineFactoriesJson: [],
        priority: 'medium',
        baseBranch: 'main',
        branch: `factory/${id}`,
        state: 'queued',
        version: 1,
        createdAt: SEED_AT,
        updatedAt: SEED_AT,
      })
      .run();
  }
};

export const insertJob = (
  db: Db,
  jobId: string,
  orderId: string,
  cellId: string,
  status: 'claimed' | 'running' | 'passed',
): void => {
  db.insert(jobs)
    .values({
      jobId: asJobId(jobId),
      projectId: asProjectId('proj-1'),
      orderId: asOrderId(orderId),
      claimedByCellId: asCellId(cellId),
      claimedByFactoryId: asFactoryId(FACTORY_ID),
      kind: 'run_operator',
      workspaceMode: 'fresh',
      status,
      repoUrl: 'git@example.test:acme/factory.git',
      baseBranch: 'main',
      targetBranch: 'factory/order',
      expectedPriorStepsJson: [],
      payloadJson: {},
      createdAt: SEED_AT,
    })
    .run();
};
