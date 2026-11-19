import { describe, expect, it } from 'vitest';
import {
  checkpointMessage,
  checkpointPaths,
} from '../../../src/domain/git/checkpoint-policy';

describe('checkpoint policy', () => {
  it('stages reported code and leaves out the cell directory', () => {
    // Arrange
    const produced = ['src/a.ts', '.cell/build/report.md', '.cell', 'src/b.ts'];

    // Act
    const paths = checkpointPaths(produced);

    // Assert
    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('stages each reported path once', () => {
    // Arrange & Act
    const paths = checkpointPaths(['src/a.ts', 'src/a.ts']);

    // Assert
    expect(paths).toEqual(['src/a.ts']);
  });

  it('uses the commit text when the build station wrote one', () => {
    // Arrange
    const commitText = 'feat(factory): add git work\n\n- adds worktree\n';

    // Act
    const message = checkpointMessage(commitText, 'cli-10');

    // Assert
    expect(message).toBe('feat(factory): add git work\n\n- adds worktree');
  });

  it('falls back to a default message when no commit text exists', () => {
    // Arrange & Act
    const message = checkpointMessage(undefined, 'cli-10');

    // Assert
    expect(message).toBe('chore(factory): checkpoint cli-10');
  });
});
