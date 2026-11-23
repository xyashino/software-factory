import { describe, expect, it } from 'vitest';
import {
  claimJobContract,
  heartbeatCellContract,
} from '@repo/factory-contracts/cells.contract';

const CLAIM_BODY = {
  waitMs: 25_000,
  projectId: 'proj-1',
  allowedLines: ['feature'],
  runners: ['claude'],
};

describe('cells contract', () => {
  it('accepts a claim body with the project, lines and runners', () => {
    const result = claimJobContract.in.body.safeParse(CLAIM_BODY);

    expect(result.success).toBe(true);
  });

  it('defaults the claim wait to zero milliseconds', () => {
    const result = claimJobContract.in.body.safeParse({
      projectId: 'proj-1',
      allowedLines: ['feature'],
      runners: ['claude'],
    });

    expect(result.success && result.data.waitMs).toBe(0);
  });

  it('refuses a claim body without a project', () => {
    const result = claimJobContract.in.body.safeParse({
      allowedLines: ['feature'],
      runners: ['claude'],
    });

    expect(result.success).toBe(false);
  });

  it('refuses a claim body with a negative wait', () => {
    const result = claimJobContract.in.body.safeParse({
      ...CLAIM_BODY,
      waitMs: -1,
    });

    expect(result.success).toBe(false);
  });

  it('accepts a heartbeat that names the job and its epoch', () => {
    const result = heartbeatCellContract.in.body.safeParse({
      jobId: 'job-1',
      epoch: 2,
    });

    expect(result.success).toBe(true);
  });

  it('accepts a claim reply with a job and with no job', () => {
    const idle = claimJobContract.out[200].safeParse({
      code: 200,
      job: null,
      signals: [],
    });

    expect(idle.success).toBe(true);
  });
});
