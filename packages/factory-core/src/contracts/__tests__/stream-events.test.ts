import { describe, expect, it } from 'vitest';
import { streamEventsResponseSchema } from '../supervisor';

const PLAN_ID = 'software-factory:plan:factory-backend';

describe('stream events', () => {
  it('accepts a plan event alongside order events', () => {
    const planEvent = {
      schemaVersion: 2,
      seq: 1,
      globalSeq: 1,
      planId: PLAN_ID,
      at: 1_700_000_000_000,
      actor: { kind: 'factory' },
      commandId: 'plan-create-1',
      event: {
        type: 'plan_created',
        projectId: 'software-factory',
        slug: 'factory-backend',
        branch: 'feat/factory-backend',
        baseBranch: 'main',
      },
    };

    const parsed = streamEventsResponseSchema.safeParse({
      events: [planEvent],
      nextSeq: 1,
    });

    expect(parsed.success).toBe(true);
  });
});
