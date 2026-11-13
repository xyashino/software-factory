import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Non-test source files under src/. */
const sourceFiles = (dir: string): string[] => {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
};

const IMPURE_CALL = /Date\.now\(|Math\.random\(|process\.|fetch\(|crypto/;

describe('factory-core purity', () => {
  const files = sourceFiles(SRC_DIR);

  it('has sources to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('reads no clock, randomness, process, fetch or crypto', () => {
    const offenders = files.filter((file) =>
      IMPURE_CALL.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
