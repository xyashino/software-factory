import { describe, expect, it } from 'vitest';
import { importQueueContract } from '../queue.contract';
import { streamQuery } from '../stream.contract';
import { createWorkOrderContract } from '../work-orders.contract';

const newOrder = {
  projectId: 'project-1',
  slug: 'add-login',
  title: 'Add login',
  type: 'feat',
  lineName: 'feature',
};

describe('create work order body', () => {
  it('fills the default priority and description when the caller omits them', () => {
    const result = createWorkOrderContract.in.body.parse(newOrder);

    expect(result.priority).toBe('medium');
    expect(result.description).toBe('');
  });

  it('rejects an order type outside the factory enum', () => {
    const result = createWorkOrderContract.in.body.safeParse({
      ...newOrder,
      type: 'hotfix',
    });

    expect(result.success).toBe(false);
  });
});

describe('import queue body', () => {
  it('accepts a dry run without a command id', () => {
    const result = importQueueContract.in.body.safeParse({
      projectId: 'project-1',
      mode: 'dry_run',
      files: [],
    });

    expect(result.success).toBe(true);
  });

  it('rejects an apply without a command id', () => {
    const result = importQueueContract.in.body.safeParse({
      projectId: 'project-1',
      mode: 'apply',
      files: [],
    });

    expect(result.success).toBe(false);
  });
});

describe('stream query', () => {
  it('reads afterSeq from the query string as a number', () => {
    const result = streamQuery.parse({ afterSeq: '5' });

    expect(result.afterSeq).toBe(5);
  });
});
