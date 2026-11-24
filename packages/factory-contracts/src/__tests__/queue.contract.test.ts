import { describe, expect, it } from 'vitest';
import { FactoryImportRequestSchema } from '../queue.contract';

const request = {
  repoRoot: '/repos/app',
};

describe('factory import request', () => {
  it('defaults dryRun, paused and local to false', () => {
    const result = FactoryImportRequestSchema.parse(request);

    expect(result).toEqual({
      repoRoot: '/repos/app',
      dryRun: false,
      paused: false,
      local: false,
    });
  });

  it('accepts an explicit todo directory', () => {
    const result = FactoryImportRequestSchema.safeParse({
      ...request,
      dir: 'backlog',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unknown field', () => {
    const result = FactoryImportRequestSchema.safeParse({
      ...request,
      commandId: 'abc',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a missing repo root', () => {
    const result = FactoryImportRequestSchema.safeParse({ local: true });

    expect(result.success).toBe(false);
  });
});
