import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const OPERATOR_SRC = join(import.meta.dirname, '..');
const PROTOCOL_SRC = join(
  import.meta.dirname,
  '../../../../packages/operator-protocol/src',
);

const FORBIDDEN_IMPORTS = [
  /apps\/cell/,
  /apps\/factory-server/,
  /packages\/factory-/,
];
const FORBIDDEN_PROTOCOL_IMPORTS = [
  'process',
  'node:process',
  'node:fs',
  'node:net',
];

const IMPORT_SPECIFIER = /from\s+['"]([^'"]+)['"]/g;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(dir, name));

const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)].map(
    (match) => match[1] ?? '',
  );

describe('package boundaries', () => {
  it('keeps operator source off cell, server and factory packages', () => {
    const offenders = sourceFiles(OPERATOR_SRC).flatMap((file) =>
      importsOf(file)
        .filter((specifier) =>
          FORBIDDEN_IMPORTS.some((pattern) => pattern.test(specifier)),
        )
        .map((specifier) => `${file}: ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it('keeps the protocol free of process, fs and network access', () => {
    const offenders = sourceFiles(PROTOCOL_SRC).flatMap((file) =>
      importsOf(file)
        .filter((specifier) => FORBIDDEN_PROTOCOL_IMPORTS.includes(specifier))
        .map((specifier) => `${file}: ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });
});
