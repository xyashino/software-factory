import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { asFactoryId, asSlotId } from '../../src/domain/common/brand';
import { cells } from '../../src/db/schema/cells';
import { factories } from '../../src/db/schema/factories';
import type { Db } from '../../src/db/client';
import { createTestDb } from '../support/test-db';

const SEED_AT = 1_700_000_000_000;

const messageChain = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause =
    error.cause === undefined ? '' : ` ${messageChain(error.cause)}`;
  return `${error.message}${cause}`;
};

const expectUniqueViolation = (action: () => void) => {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(messageChain(caught)).toMatch(/UNIQUE constraint failed/);
};

const insertFactory = (db: Db, factoryId: string, isDefault: boolean) =>
  db
    .insert(factories)
    .values({
      factoryId: asFactoryId(factoryId),
      url: 'http://127.0.0.1:7070',
      isDefault,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .run();

const insertCell = (
  db: Db,
  slot: {
    slotId: string;
    cellId: string | null;
    repoRoot: string;
    name: string;
  },
) =>
  db
    .insert(cells)
    .values({
      slotId: asSlotId(slot.slotId),
      cellId: slot.cellId,
      factoryId: asFactoryId('factory-1'),
      repoRoot: slot.repoRoot,
      name: slot.name,
      desiredState: 'stopped',
      runtimeStatus: 'stopped',
      pid: null,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .run();

const seededDb = (): Db => {
  const db = createTestDb();
  insertFactory(db, 'factory-1', false);
  return db;
};

describe('factories default index', () => {
  it('rejects a second factory marked as default', () => {
    const db = seededDb();
    insertFactory(db, 'factory-2', true);

    expectUniqueViolation(() => insertFactory(db, 'factory-3', true));
  });
});

describe('cells indexes', () => {
  it('rejects two cells with the same repo root and name', () => {
    const db = seededDb();
    insertCell(db, {
      slotId: 'slot-1',
      cellId: null,
      repoRoot: '/repo',
      name: 'main',
    });

    expectUniqueViolation(() =>
      insertCell(db, {
        slotId: 'slot-2',
        cellId: null,
        repoRoot: '/repo',
        name: 'main',
      }),
    );
  });

  it('rejects two slots bound to the same cell id under one factory', () => {
    const db = seededDb();
    insertCell(db, {
      slotId: 'slot-1',
      cellId: 'cell-1',
      repoRoot: '/repo-a',
      name: 'a',
    });

    expectUniqueViolation(() =>
      insertCell(db, {
        slotId: 'slot-2',
        cellId: 'cell-1',
        repoRoot: '/repo-b',
        name: 'b',
      }),
    );
  });

  it('allows many slots without a cell id', () => {
    const db = seededDb();
    insertCell(db, {
      slotId: 'slot-1',
      cellId: null,
      repoRoot: '/repo-a',
      name: 'a',
    });

    expect(() =>
      insertCell(db, {
        slotId: 'slot-2',
        cellId: null,
        repoRoot: '/repo-b',
        name: 'b',
      }),
    ).not.toThrow();
  });

  it('rejects a slot that points at a factory which does not exist', () => {
    const db = createTestDb();

    expect(() =>
      insertCell(db, {
        slotId: 'slot-1',
        cellId: null,
        repoRoot: '/repo',
        name: 'main',
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('schema objects', () => {
  it('declares the partial index that restricts the default factory', () => {
    const db = createTestDb();

    const index = db.all<{ sql: string | null }>(
      sql`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_factories_one_default'`,
    );

    expect(index[0]?.sql).toMatch(/WHERE/);
  });
});
