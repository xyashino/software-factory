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

describe('factory-cell boundaries', () => {
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

  it('rejects an import of factory-definitions', async () => {
    const rules = await reportedRules(
      `import { x } from '@repo/factory-definitions/operators';`,
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects an import of the runtime library from Cell source', async () => {
    const rules = await reportedRules(
      `import { createRuntime } from '@repo/factory-runtime/composition';`,
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects an import of factory-server from Cell source', async () => {
    const rules = await reportedRules(
      `import { startSocketListener } from '@repo/factory-server/socket/listener';`,
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('allows the e2e tests to boot the runtime and the server', async () => {
    const eslint = new ESLint({ cwd: PACKAGE_DIR });
    const [result] = await eslint.lintText(
      `import { openRuntime } from '@repo/factory-runtime/open-runtime';\nimport { startSocketListener } from '@repo/factory-server/socket/listener';`,
      { filePath: resolve(PACKAGE_DIR, 'src/__tests__/e2e/probe.ts') },
    );
    expect(
      (result?.messages ?? []).map((message) => message.ruleId),
    ).not.toContain('no-restricted-imports');
  });

  it('accepts an import of factory-core', async () => {
    const rules = await reportedRules(
      `import { PACKAGE_NAME } from '@repo/factory-core/meta';`,
    );
    expect(rules).not.toContain('no-restricted-imports');
  });
});
