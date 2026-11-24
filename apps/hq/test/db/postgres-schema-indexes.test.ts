import { describe, expect, it } from 'vitest';
import { createPostgresStorageAdapter } from '../../src/adapters/storage/postgres-storage.adapter';
import { POSTGRES_URL, postgresIndexes } from '../support/postgres';

const PARTIAL_INDEXES = [
  'idx_jobs_one_active_per_order',
  'idx_jobs_one_active_per_cell',
  'idx_work_orders_one_active_per_cell',
];

describe.skipIf(POSTGRES_URL === '')('postgres schema indexes', () => {
  it('applies migrations that declare the three partial unique indexes', async () => {
    // Arrange
    await createPostgresStorageAdapter(POSTGRES_URL);

    // Act
    const indexes = await postgresIndexes(POSTGRES_URL);

    // Assert
    for (const name of PARTIAL_INDEXES) {
      const index = indexes.find((row) => row.indexname === name);
      expect(index?.indexdef).toMatch(/CREATE UNIQUE INDEX/);
      expect(index?.indexdef).toMatch(/WHERE/);
    }
  });
});
