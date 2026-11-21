import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APPLICATION_URL = new URL('../../../src/application/', import.meta.url);

const NODE_BUILTINS = [
  'child_process',
  'crypto',
  'dns',
  'fs',
  'http',
  'https',
  'net',
  'os',
  'path',
  'process',
  'readline',
  'stream',
  'tls',
  'url',
  'worker_threads',
  'zlib',
];

const ADAPTER_OR_WIRING_PATH = /(^|\/)(adapters|bootstrap)(\/|$)/;

const IMPORT_SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]/g;

const isForbidden = (specifier: string): boolean =>
  specifier.startsWith('node:') ||
  NODE_BUILTINS.includes(specifier) ||
  ADAPTER_OR_WIRING_PATH.test(specifier);

const sourceFiles = readdirSync(fileURLToPath(APPLICATION_URL), {
  recursive: true,
}).filter((name) => name.endsWith('.ts'));

describe('application layer boundary', () => {
  it('imports no adapter, bootstrap wiring or Node I/O module', () => {
    // Arrange
    // Act
    const violations = sourceFiles.flatMap((file) => {
      const source = readFileSync(new URL(file, APPLICATION_URL), 'utf8');
      return [...source.matchAll(IMPORT_SPECIFIER)]
        .map((match) => match[1])
        .filter(isForbidden)
        .map((specifier) => `${file}: ${specifier}`);
    });

    // Assert
    expect(violations).toEqual([]);
  });
});
