import { describe, expect, it } from 'vitest';
import {
  baseRefOf,
  factoryBranchOf,
  planBranchOf,
  slugOf,
} from '../../../src/domain/git/branch-names';

describe('work order branch names', () => {
  it('names the work order branch after its slug', () => {
    // Arrange & Act
    const branch = factoryBranchOf('cli-10');

    // Assert
    expect(branch).toBe('factory/cli-10');
  });

  it('names the plan branch under feat', () => {
    // Arrange & Act
    const branch = planBranchOf('worktree-plan');

    // Assert
    expect(branch).toBe('feat/worktree-plan');
  });

  it('takes the slug from the last segment of the order id', () => {
    // Arrange & Act
    const slug = slugOf('software-factory:cli-10');

    // Assert
    expect(slug).toBe('cli-10');
  });

  it('yields an empty slug when the job has no order', () => {
    // Arrange & Act
    const slug = slugOf(null);

    // Assert
    expect(slug).toBe('');
  });
});

describe('base ref', () => {
  it('uses the local branch when it exists', () => {
    expect(baseRefOf('main', true)).toBe('main');
  });

  it('uses the origin branch when the base exists only on origin', () => {
    expect(baseRefOf('feat/standalone-factory', false)).toBe(
      'origin/feat/standalone-factory',
    );
  });
});
