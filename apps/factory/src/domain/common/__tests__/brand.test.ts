import { describe, expect, it } from 'vitest';
import { asCellId, asProjectId } from '../brand';

describe('branded ids', () => {
  it('keeps a non-empty project id as given', () => {
    const projectId = asProjectId('proj-1');

    expect(projectId).toBe('proj-1');
  });

  it('rejects an empty project id', () => {
    expect(() => asProjectId('')).toThrow('ProjectId must not be empty');
  });

  it('rejects a cell id made only of spaces', () => {
    expect(() => asCellId('   ')).toThrow('CellId must not be empty');
  });
});
