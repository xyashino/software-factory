import { describe, expect, it } from 'vitest';
import {
  domainErrorToWire,
  invalidWire,
  WIRE_STATUS,
  wireErrorSchema,
} from '../errors';
import { jobSchema } from '../job';
import { ROUTES, routeByPath } from '../routes';
import { helloRequestSchema, submitCommandRequestSchema } from '../worker';

const JOB_ID = '01J0000000000000000000000J';
const ORDER_ID = 'software-factory:todo-a';
const WORKER_ID = '01J0000000000000000000000W';

/** A minimal valid Job; tests change one field of it. */
const baseJob = {
  jobId: JOB_ID,
  orderId: ORDER_ID,
  projectId: 'software-factory',
  epoch: 1,
  kind: 'run_operator_station',
  repo: {
    url: 'https://example.test/sf.git',
    baseBranch: 'main',
    branch: 'factory/todo-a',
  },
  base: { branchBase: 'main' },
  workspace: {
    dir: 'todo-a',
    sync: [],
    setup: ['pnpm install'],
    timeoutMs: 600_000,
  },
  station: {
    stationId: 'plan',
    cycleId: '01J0000000000000000000000C',
    n: 1,
    cause: { kind: 'first' },
    outputs: [{ key: 'plan', path: '.worker/outputs/plan', required: true }],
  },
};

describe('Job contract', () => {
  it('accepts a job whose paths are all relative', () => {
    expect(jobSchema.safeParse(baseJob).success).toBe(true);
  });

  it.each([
    ['a POSIX absolute path', '/home/worker/todo-a'],
    ['a Windows drive path', 'C:\\work\\todo-a'],
    ['a Windows root path', '\\work\\todo-a'],
    ['a path that climbs out', '../todo-a'],
  ])('rejects %s in the workspace directory', (_label, dir) => {
    const job = { ...baseJob, workspace: { ...baseJob.workspace, dir } };

    expect(jobSchema.safeParse(job).success).toBe(false);
  });

  it('rejects an absolute output path inside a station', () => {
    const job = {
      ...baseJob,
      station: {
        ...baseJob.station,
        outputs: [{ key: 'plan', path: '/tmp/plan', required: true }],
      },
    };

    expect(jobSchema.safeParse(job).success).toBe(false);
  });
});

describe('error contract', () => {
  it('maps every domain refusal to its wire form, shape for shape', () => {
    expect(domainErrorToWire({ code: 'not_found' })).toEqual({
      code: 'not_found',
    });
    expect(domainErrorToWire({ code: 'stale_epoch', current: 4 })).toEqual({
      code: 'stale_epoch',
      current: 4,
    });
    expect(
      domainErrorToWire({ code: 'not_live', cycleId: 'C' as never }),
    ).toEqual({
      code: 'not_live',
      cycleId: 'C',
    });
    expect(domainErrorToWire({ code: 'precondition', detail: 'busy' })).toEqual(
      {
        code: 'precondition',
        detail: 'busy',
      },
    );
    expect(domainErrorToWire({ code: 'invalid', issues: ['x'] })).toEqual({
      code: 'invalid',
      issues: ['x'],
    });
  });

  it('round-trips every wire error through its schema', () => {
    for (const error of [
      { code: 'unavailable' },
      { code: 'unauthorized' },
      { code: 'stale_epoch', current: 2 },
    ] as const) {
      expect(wireErrorSchema.parse(error)).toEqual(error);
    }
  });

  it('answers invalid with 422 and unavailable with 503', () => {
    expect(WIRE_STATUS.invalid).toBe(422);
    expect(WIRE_STATUS.unavailable).toBe(503);
  });

  it('turns schema issues into one line per problem', () => {
    const parsed = helloRequestSchema.safeParse({ workerId: 'nope' });
    if (parsed.success) throw new Error('expected a failure');

    const wire = invalidWire(parsed.error.issues);

    expect(wire.code).toBe('invalid');
    expect(wire.code === 'invalid' && wire.issues.length).toBeGreaterThan(0);
  });
});

describe('route table', () => {
  it('names every route once and resolves each path back to its name', () => {
    const paths = Object.values(ROUTES).map((route) => route.path);

    expect(new Set(paths).size).toBe(paths.length);
    for (const [name, route] of Object.entries(ROUTES)) {
      expect(routeByPath(route.path)).toBe(name);
    }
  });

  it('answers an unknown path with no route', () => {
    expect(routeByPath('worker/unknown')).toBeUndefined();
  });

  it('keeps a worker command to the Worker and the epoch it holds', () => {
    const parsed = submitCommandRequestSchema.safeParse({
      workerId: WORKER_ID,
      orderId: ORDER_ID,
      commandId: 'c-1',
      epoch: 1,
      command: { type: 'StartCycle', baseCommit: 'a'.repeat(40) },
    });

    expect(parsed.success).toBe(true);
  });
});
