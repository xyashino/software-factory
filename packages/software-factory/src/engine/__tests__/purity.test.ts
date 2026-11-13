import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Non-test engine source files. */
const engineSources = (dir: string): string[] => {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : engineSources(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [path]
      : [];
  });
};

const FORBIDDEN_IMPORT =
  /from\s+['"](\.\.\/)*(adapters|supervisor|cli)\/|from\s+['"](bun:|node:)|import\(\s*['"](bun:|node:)/;
const FORBIDDEN_CALL =
  /Date\.now\(|Math\.random\(|process\.env|console\.|new Date\(\)|performance\.now\(/;

describe('engine purity', () => {
  const files = engineSources(ENGINE_DIR);

  it('is not empty', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports nothing from adapters, supervisor, cli, bun or node', () => {
    const offenders = files.filter((file) =>
      FORBIDDEN_IMPORT.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('reads no clock, randomness, environment or console', () => {
    const offenders = files.filter((file) =>
      FORBIDDEN_CALL.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('imports only its own files, definitions/types and zod', () => {
    const offenders = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)]
        .map((match) => match[1] ?? '')
        .filter(
          (target) =>
            !target.startsWith('./') &&
            target !== '../definitions/types' &&
            target !== 'zod',
        )
        .map((target) => `${file}: ${target}`),
    );
    expect(offenders).toEqual([]);
  });
});
