import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRepoDefinitions } from '../load';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');
const SHIPPED_FACTORY = join(PACKAGE_ROOT, '..', '..', '.factory');

/** A fresh repository root holding a copy of the shipped `.factory/` when `withFactory` is set. */
const repoWith = (withFactory: boolean): string => {
  const repo = mkdtempSync(join(tmpdir(), 'sf-repo-'));
  if (withFactory) {
    cpSync(SHIPPED_FACTORY, join(repo, '.factory'), { recursive: true });
  }
  return repo;
};

describe('loadRepoDefinitions', () => {
  it('reads lines, operators and templates from the repository .factory/ directory', async () => {
    const repo = repoWith(true);

    const loaded = await loadRepoDefinitions(repo);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect([...loaded.value.lines.keys()].sort()).toEqual([
      'fast',
      'feature',
      'standard',
    ]);
    expect(loaded.value.operators.has('builder')).toBe(true);
    expect(loaded.value.templates.has('answer')).toBe(true);
    expect(loaded.value.prTemplates.has('body')).toBe(true);
  });

  it('answers with one actionable error when the repository has no .factory/ directory', async () => {
    const repo = repoWith(false);

    const loaded = await loadRepoDefinitions(repo);

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error).toEqual([
      expect.objectContaining({
        file: '.factory',
        field: '(directory)',
        message: expect.stringContaining(
          'add lines/, operators/ and templates/',
        ),
      }),
    ]);
  });

  it('keeps two repositories with distinct .factory/ definitions apart', async () => {
    const first = repoWith(true);
    const second = repoWith(true);
    rmSync(join(second, '.factory', 'lines', 'fast.yml'));

    const firstLoaded = await loadRepoDefinitions(first);
    const secondLoaded = await loadRepoDefinitions(second);

    expect(firstLoaded.ok && firstLoaded.value.lines.has('fast')).toBe(true);
    expect(secondLoaded.ok && secondLoaded.value.lines.has('fast')).toBe(false);
    expect(secondLoaded.ok && secondLoaded.value.lines.has('feature')).toBe(
      true,
    );
  });
});
