import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDefinitions } from '../load';
import { scaffoldFactory, STARTER_ROOT, starterFiles } from '../scaffold';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'factory-scaffold-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('the starter .factory/ tree', () => {
  it('ships the three Lines, four Operators, prompt and PR templates', () => {
    const files = starterFiles();
    expect(files).toContain('lines/feature.yml');
    expect(files).toContain('lines/fast.yml');
    expect(files).toContain('lines/standard.yml');
    expect(files.filter((f) => f.startsWith('operators/'))).toHaveLength(4);
    expect(
      files.filter((f) => f.startsWith('templates/prompts/')),
    ).toHaveLength(11);
    expect(files.filter((f) => f.startsWith('templates/pr/'))).toHaveLength(3);
  });
});

describe('scaffoldFactory', () => {
  it('copies the starter into an empty repository and the result passes definitions', () => {
    const { written } = scaffoldFactory(repo);
    expect(written).toEqual(starterFiles());

    const read = readDefinitions(join(repo, '.factory'));
    expect(read.errors).toEqual([]);
    expect([...read.definitions.lines.keys()].sort()).toEqual([
      'fast',
      'feature',
      'standard',
    ]);
  });

  it('refuses a repository that already has a .factory/ directory', () => {
    mkdirSync(join(repo, '.factory'));
    expect(() => scaffoldFactory(repo)).toThrow(/already exists.*--force/);
  });

  it('with force, overwrites the starter files and keeps any other file', () => {
    scaffoldFactory(repo);
    const lineFile = join(repo, '.factory', 'lines', 'feature.yml');
    writeFileSync(lineFile, 'changed: true\n');
    const extra = join(repo, '.factory', 'lines', 'mine.yml');
    writeFileSync(extra, 'name: mine\n');

    scaffoldFactory(repo, { force: true });

    expect(readFileSync(lineFile, 'utf8')).toBe(
      readFileSync(join(STARTER_ROOT, 'lines', 'feature.yml'), 'utf8'),
    );
    expect(readFileSync(extra, 'utf8')).toBe('name: mine\n');
  });
});
