import { describe, expect, it } from 'vitest';
import {
  extractObjective,
  formatAdrEntries,
  formatChecks,
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

  it('takes the objective from the Objective section', () => {
    // Arrange
    const description =
      '# Task\n\n## 🎯 Objective\n\nShip it.\n\n## Scope\n\nx';

    // Act
    const objective = extractObjective(description, 'title');

    // Assert
    expect(objective).toBe('Ship it.');
  });

  it('falls back to the first paragraph, then to the title', () => {
    // Arrange & Act
    const paragraph = extractObjective(
      '# Heading\n\nFirst line.\n\nMore.',
      't',
    );
    const title = extractObjective('', 'the title');

    // Assert
    expect(paragraph).toBe('First line.');
    expect(title).toBe('the title');
  });

  it('inlines an ADR entry with its summary, why and body', () => {
    // Arrange
    const content =
      '---\nsummary: Short one\nwhy: "Because: reasons"\n---\n\n- did a thing\n';

    // Act
    const adr = formatAdrEntries([{ path: 'decisions/a.md', content }]);

    // Assert
    expect(adr).toBe(
      '**[`decisions/a.md`](decisions/a.md)**\n\nShort one\n\n> **Why:** Because: reasons\n\n- did a thing',
    );
  });

  it('says so when no ADR entry exists', () => {
    // Arrange & Act
    const adr = formatAdrEntries([]);

    // Assert
    expect(adr).toBe('_No `decisions/` entry recorded for this change._');
  });

  it('lists each check command as done', () => {
    // Arrange & Act
    const checks = formatChecks(['pnpm lint', 'pnpm test']);

    // Assert
    expect(checks).toBe('- [x] `pnpm lint`\n- [x] `pnpm test`');
    expect(formatChecks([])).toBe('_No automated checks configured._');
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
