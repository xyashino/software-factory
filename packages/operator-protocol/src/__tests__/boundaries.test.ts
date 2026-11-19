import { describe, expect, it } from 'vitest';

declare global {
  interface ImportMeta {
    glob: (
      pattern: string,
      options: { query: string; import: string; eager: true },
    ) => Record<string, string>;
  }
}

const SOURCES: Record<string, string> = import.meta.glob('../**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const FORBIDDEN_MODULE = /^(node:)?(process|fs(\/promises)?|net)$/;

const IMPORT_SPECIFIER =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

const importsOf = (source: string): string[] =>
  [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? '');

describe('protocol boundaries', () => {
  it('keeps the protocol free of process, fs and network access', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([file]) => !file.includes('__tests__'))
      .flatMap(([file, source]) =>
        importsOf(source)
          .filter((specifier) => FORBIDDEN_MODULE.test(specifier))
          .map((specifier) => `${file}: ${specifier}`),
      );

    expect(offenders).toEqual([]);
  });
});
