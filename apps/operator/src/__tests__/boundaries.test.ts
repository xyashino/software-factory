import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const OPERATOR_SRC = join(import.meta.dirname, '..');

const FORBIDDEN_PATH =
  /\/(apps\/(cell|factory|sf|web-demo|server|worker|operator-cli)|packages\/factory-)[^/]*\//;
const FORBIDDEN_PACKAGE = /^@repo\/(factory|sf|cell|web-demo)(-|\/|$)/;

const IMPORT_SPECIFIER =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(dir, name));

const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)].map(
    (match) => match[1] ?? '',
  );

const isForbidden = (file: string, specifier: string): boolean => {
  if (specifier.startsWith('.')) {
    return FORBIDDEN_PATH.test(`${resolve(dirname(file), specifier)}/`);
  }
  return FORBIDDEN_PACKAGE.test(specifier);
};

describe('operator boundaries', () => {
  it('keeps operator source off cell, server and factory packages', () => {
    const offenders = sourceFiles(OPERATOR_SRC).flatMap((file) =>
      importsOf(file)
        .filter((specifier) => isForbidden(file, specifier))
        .map((specifier) => `${file}: ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });
});
