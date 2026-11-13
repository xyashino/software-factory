import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = resolve(PACKAGE_DIR, 'src/fixture.ts');

/** Rule ids that ESLint reports for a fixture source linted as src/fixture.ts. */
const reportedRules = async (code: string): Promise<string[]> => {
  const eslint = new ESLint({ cwd: PACKAGE_DIR });
  const [result] = await eslint.lintText(code, { filePath: FIXTURE });
  return (result?.messages ?? []).map((message) => message.ruleId ?? '');
};

describe('factory-core boundaries', () => {
  it('rejects a bun:sqlite import', async () => {
    const rules = await reportedRules(`import { Database } from 'bun:sqlite';`);
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects a node:fs import', async () => {
    const rules = await reportedRules(
      `import { readFileSync } from 'node:fs';`,
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects an import of the v1 package', async () => {
    const rules = await reportedRules(
      `import { x } from '@repo/software-factory/engine';`,
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects an import of factory-db', async () => {
    const rules = await reportedRules(`import { x } from '@repo/factory-db';`);
    expect(rules).toContain('no-restricted-imports');
  });

  it('accepts a relative import', async () => {
    const rules = await reportedRules(`import { x } from './meta';`);
    expect(rules).not.toContain('no-restricted-imports');
  });
});
