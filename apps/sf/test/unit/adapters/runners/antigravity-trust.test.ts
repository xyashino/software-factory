import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acceptAntigravityTrust } from '../../../../src/adapters/runners/antigravity-trust';

const settingsFile = (content?: object): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'agy-trust-')), 'settings.json');
  if (content !== undefined) writeFileSync(path, JSON.stringify(content));
  return path;
};

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

describe('antigravity trust', () => {
  it('trusts a new worktree and keeps the other settings', () => {
    // Arrange
    const path = settingsFile({ model: 'flash', trustedWorkspaces: ['/a'] });

    // Act
    acceptAntigravityTrust(path, '/wt');

    // Assert
    expect(read(path)).toEqual({
      model: 'flash',
      trustedWorkspaces: ['/a', '/wt'],
    });
  });

  it('trusts a folder only once', () => {
    // Arrange
    const path = settingsFile({ trustedWorkspaces: ['/wt'] });

    // Act
    acceptAntigravityTrust(path, '/wt');

    // Assert
    expect(read(path)).toEqual({ trustedWorkspaces: ['/wt'] });
  });

  it('creates the settings when the file does not exist yet', () => {
    // Arrange
    const path = settingsFile();

    // Act
    acceptAntigravityTrust(path, '/wt');

    // Assert
    expect(read(path)).toEqual({ trustedWorkspaces: ['/wt'] });
  });
});
