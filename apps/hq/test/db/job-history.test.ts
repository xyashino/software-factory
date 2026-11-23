import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { asJobId } from '../../src/domain/common/brand';
import { jobs } from '../../src/db/schema/jobs';
import { createTestDb, insertJob, seedBaseline } from '../support/test-db';

describe('job history', () => {
  it('keeps the cell id that ran an old job after its cell is gone', () => {
    // Arrange
    const db = createTestDb();
    seedBaseline(db);
    insertJob(db, 'job-1', 'order-1', 'cell-aaaaaaaa', 'passed');

    // Act
    const row = db
      .select()
      .from(jobs)
      .where(eq(jobs.jobId, asJobId('job-1')))
      .get();

    // Assert
    expect(row).toMatchObject({
      status: 'passed',
      claimedByCellId: 'cell-aaaaaaaa',
      claimedByFactoryId: 'factory-1',
    });
  });
});
