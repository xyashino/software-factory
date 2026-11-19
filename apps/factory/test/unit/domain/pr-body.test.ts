import { describe, expect, it } from 'vitest';
import {
  prChangesOf,
  prTitleOf,
  renderPrBody,
} from '../../../src/domain/git/pr-body';

const COMMIT = 'feat(factory): add git work\n\n- adds worktree\n- adds deliver';

describe('pull request text', () => {
  it('takes the title from the first line of the commit', () => {
    // Arrange & Act
    const title = prTitleOf(COMMIT);

    // Assert
    expect(title).toBe('feat(factory): add git work');
  });

  it('takes the change list from the lines after the title', () => {
    // Arrange & Act
    const changes = prChangesOf(COMMIT);

    // Assert
    expect(changes).toBe('- adds worktree\n- adds deliver');
  });

  it('fills known placeholders and blanks unknown ones', () => {
    // Arrange
    const template = 'Task {{taskId}}: {{objective}} {{missing}}';

    // Act
    const body = renderPrBody(template, { taskId: 'cli-10', objective: 'git' });

    // Assert
    expect(body).toBe('Task cli-10: git ');
  });
});
