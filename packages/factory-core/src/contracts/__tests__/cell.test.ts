import { describe, expect, it } from 'vitest';
import { commandResultSchema, submitCommandRequestSchema } from '../cell';

const CELL_ID = '01J0000000000000000000000W';
const JOB_ID = '01J0000000000000000000000J';
const ORDER_ID = 'software-factory:todo-a';
const PLAN_ID = 'software-factory:plan:feat-x';
const SHA = 'a'.repeat(40);

const common = {
  cellId: CELL_ID,
  commandId: `${JOB_ID}:report`,
  epoch: 2,
  jobId: JOB_ID,
};

describe('submitCommand request: order and plan variants', () => {
  it('accepts a Work order command under orderId', () => {
    const request = {
      ...common,
      orderId: ORDER_ID,
      command: { type: 'ReleaseJob' },
    };
    expect(submitCommandRequestSchema.safeParse(request).success).toBe(true);
  });

  it('accepts a plan command under planId', () => {
    const request = {
      ...common,
      planId: PLAN_ID,
      command: { type: 'ReportPlanBranch', commit: SHA },
    };
    expect(submitCommandRequestSchema.safeParse(request).success).toBe(true);
  });

  it('accepts a dry-run plan command', () => {
    const request = {
      ...common,
      planId: PLAN_ID,
      dryRun: true,
      command: { type: 'ReportPlanReady' },
    };
    expect(submitCommandRequestSchema.safeParse(request).success).toBe(true);
  });

  it('rejects a request that names both an orderId and a planId', () => {
    const request = {
      ...common,
      orderId: ORDER_ID,
      planId: PLAN_ID,
      command: { type: 'ReleaseJob' },
    };
    expect(submitCommandRequestSchema.safeParse(request).success).toBe(false);
  });

  it('rejects a plan command sent under an orderId', () => {
    const request = {
      ...common,
      orderId: ORDER_ID,
      command: { type: 'ReportPlanBranch', commit: SHA },
    };
    expect(submitCommandRequestSchema.safeParse(request).success).toBe(false);
  });

  it('rejects a Work order command sent under a planId', () => {
    const request = {
      ...common,
      planId: PLAN_ID,
      command: { type: 'ReleaseJob' },
    };
    expect(submitCommandRequestSchema.safeParse(request).success).toBe(false);
  });

  it('rejects a request with neither key', () => {
    const request = { ...common, command: { type: 'ReleaseJob' } };
    expect(submitCommandRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe('commandResult: plan events', () => {
  it('accepts plan events in the events list, with next null', () => {
    const result = {
      dryRun: false,
      events: [
        { type: 'plan_branch_created', commit: SHA },
        { type: 'plan_pr_ready' },
      ],
      next: null,
    };
    expect(commandResultSchema.safeParse(result).success).toBe(true);
  });

  it('rejects an event that is neither an order nor a plan event', () => {
    const result = {
      dryRun: false,
      events: [{ type: 'no_such_event' }],
      next: null,
    };
    expect(commandResultSchema.safeParse(result).success).toBe(false);
  });
});
