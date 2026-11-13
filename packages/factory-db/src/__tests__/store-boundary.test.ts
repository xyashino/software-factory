import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** RULES §4.6: the store writes what it is handed. It never decides, picks a job or folds a row. */
const FORBIDDEN = /\b(decide|nextJob|toProjection)\b/;

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Non-test source files under src/ (tests may use core's projection to build fixtures). */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });

describe('factory-db never decides', () => {
  const files = sourceFiles(SRC_DIR);

  it('has sources to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('calls neither decide, nextJob nor toProjection in any source file', () => {
    const offenders = files.filter((file) =>
      FORBIDDEN.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
