import { describe, expect, it } from 'vitest';
import {
  globToRegExp,
  keyDigestOf,
  keyLinesOf,
  parseLsTree,
  type TrackedFile,
} from '../../workspace/key-files';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('globToRegExp', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm-lock.yaml', true],
    ['pnpm-lock.yaml', 'pnpm-lock.yamlx', false],
    ['*.json', 'package.json', true],
    ['*.json', 'packages/app/package.json', false],
    ['packages/*/package.json', 'packages/app/package.json', true],
    ['packages/*/package.json', 'packages/a/b/package.json', false],
    ['**/package.json', 'package.json', true],
    ['**/package.json', 'packages/a/b/package.json', true],
    ['src/**', 'src/a/b.ts', true],
    ['file?.txt', 'file1.txt', true],
    ['file?.txt', 'file10.txt', false],
    ['a.b', 'axb', false],
    ['(x)+', '(x)+', true],
  ])('matches %s against %s: %s', (glob, path, matches) => {
    expect(globToRegExp(glob).test(path)).toBe(matches);
  });
});

describe('parseLsTree', () => {
  it('reads the blob and path of each NUL-terminated entry, paths included verbatim', () => {
    const nul = '\u0000';
    const text = `100644 blob ${A}\tpnpm-lock.yaml${nul}100644 blob ${B}\tdocs/a b.md${nul}`;
    expect(parseLsTree(text)).toEqual([
      { path: 'pnpm-lock.yaml', blob: A },
      { path: 'docs/a b.md', blob: B },
    ]);
  });

  it('reads nothing from empty output', () => {
    expect(parseLsTree('')).toEqual([]);
  });
});

describe('keyLinesOf', () => {
  const files: TrackedFile[] = [
    { path: 'pnpm-lock.yaml', blob: A },
    { path: 'package.json', blob: B },
    { path: 'packages/app/package.json', blob: A },
  ];

  it('names a literal key file by its blob', () => {
    expect(keyLinesOf(files, ['pnpm-lock.yaml'])).toEqual([
      `pnpm-lock.yaml ${A}`,
    ]);
  });

  it('marks a literal key file the commit does not track as absent', () => {
    expect(keyLinesOf(files, ['missing.lock'])).toEqual(['missing.lock -']);
  });

  it('names every tracked match of a glob, and nothing for a glob with no match', () => {
    expect(keyLinesOf(files, ['**/package.json'])).toEqual([
      `package.json ${B}`,
      `packages/app/package.json ${A}`,
    ]);
    expect(keyLinesOf(files, ['*.gradle'])).toEqual([]);
  });

  it('sorts the lines and names each path once, however many patterns name it', () => {
    expect(
      keyLinesOf(files, ['pnpm-lock.yaml', '*.yaml', 'pnpm-lock.yaml']),
    ).toEqual([`pnpm-lock.yaml ${A}`]);
  });
});

describe('keyDigestOf', () => {
  it('gives the same digest for the same lines', () => {
    const lines = [`pnpm-lock.yaml ${A}`, `package.json ${B}`];
    expect(keyDigestOf(lines)).toBe(keyDigestOf([...lines]));
  });

  it('changes when a blob changes', () => {
    expect(keyDigestOf([`pnpm-lock.yaml ${A}`])).not.toBe(
      keyDigestOf([`pnpm-lock.yaml ${B}`]),
    );
  });

  it('is a sha256 hex digest', () => {
    expect(keyDigestOf([`x ${A}`])).toMatch(/^[0-9a-f]{64}$/);
  });
});
