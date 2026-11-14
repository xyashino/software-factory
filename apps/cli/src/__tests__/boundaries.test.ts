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

describe('factory-cli boundaries', () => {
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

  it('rejects an import of core/cycle', async () => {
    const rules = await reportedRules(
      `import { watch } from '@repo/factory-core/cycle/watch';`,
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects an import of factory-runtime, the server runs it and the CLI talks to it', async () => {
    const rules = await reportedRules(
      `import { openRuntime } from '@repo/factory-runtime/open-runtime';`,
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects an import of factory-server', async () => {
    const rules = await reportedRules(
      `import { serveRequest } from '@repo/factory-server/socket/serve';`,
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('accepts an import of factory-definitions', async () => {
    const rules = await reportedRules(
      `import { x } from '@repo/factory-definitions/meta';`,
    );
    expect(rules).not.toContain('no-restricted-imports');
  });
});
