import { describe, expect, it } from 'vitest';
import {
  ActivitySchema,
  ProjectsScaleReplySchema,
  ScaleRequestBodySchema,
} from '../scale.contract';

const scaleBody = {
  repoRoot: '/repos/app',
  count: 2,
  lines: ['fast'],
};

const cell = {
  cellId: 'cell-1',
  name: 'cell-1',
  projectId: 'project-1',
  repoRoot: '/repos/app',
  pid: 100,
  startedAt: 1_700_000_000_000,
  state: 'idle',
  writes: false,
  since: 1_700_000_000_500,
};

describe('activity', () => {
  it('defaults writes to false when the caller omits it', () => {
    const result = ActivitySchema.parse({ state: 'running', since: 1 });

    expect(result.writes).toBe(false);
  });

  it('rejects an activity state outside idle and running', () => {
    const result = ActivitySchema.safeParse({
      state: 'sleeping',
      since: 1,
    });

    expect(result.success).toBe(false);
  });
});

describe('scale request body', () => {
  it('accepts a body without lines', () => {
    const result = ScaleRequestBodySchema.safeParse({
      repoRoot: '/repos/app',
      count: 0,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a negative cell count', () => {
    const result = ScaleRequestBodySchema.safeParse({
      ...scaleBody,
      count: -1,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an empty line entry', () => {
    const result = ScaleRequestBodySchema.safeParse({
      ...scaleBody,
      lines: [''],
    });

    expect(result.success).toBe(false);
  });

  it('rejects an empty lines list', () => {
    const result = ScaleRequestBodySchema.safeParse({
      ...scaleBody,
      lines: [],
    });

    expect(result.success).toBe(false);
  });
});

describe('projects scale reply', () => {
  it('accepts projects with nested cells', () => {
    const result = ProjectsScaleReplySchema.safeParse({
      projects: [
        {
          projectId: 'project-1',
          repoRoot: '/repos/app',
          desired: 1,
          running: 1,
          crashLoop: false,
          cells: [cell],
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
