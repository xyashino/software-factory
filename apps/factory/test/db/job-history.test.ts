import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { asCellId, asJobId } from '../../src/domain/common/brand';
import { cells } from '../../src/db/schema/cells';
import { jobs } from '../../src/db/schema/jobs';
import { createTestDb, insertJob, seedBaseline } from '../support/test-db';

describe('job history', () => {
  it('keeps the cell id on an old job after its cell row is deleted', () => {
    // Arrange
    const db = createTestDb();
    seedBaseline(db);
    insertJob(db, 'job-1', 'order-1', 'cell-1', 'passed');

    // Act
    db.delete(cells)
      .where(eq(cells.cellId, asCellId('cell-1')))
      .run();

    // Assert
    expect(
      db
        .select()
        .from(jobs)
        .where(eq(jobs.jobId, asJobId('job-1')))
        .get(),
    ).toMatchObject({ status: 'passed', cellId: 'cell-1' });
  });
});
