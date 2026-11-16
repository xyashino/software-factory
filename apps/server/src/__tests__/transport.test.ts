import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The HTTP-only transport (PROTOCOL §2): no app source keeps the Unix socket. This guard reads every
 * production source file of the four apps and fails on any trace of `factory.sock`, a `unix:` bind, or
 * the removed socket client and listener. Test files are not read: they assert the socket's absence.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const APPS = ['cell', 'cli', 'server', 'operator-cli'] as const;

const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  { name: 'the socket file name', pattern: /\bfactory\.sock\b/ },
  { name: 'a unix socket option', pattern: /\bunix\s*:/ },
  {
    name: 'the removed socket client or listener',
    pattern:
      /socketFactoryClient|startSocketListener|SocketListener|SOCKET_FILE_NAME|socketPathIn/,
  },
  {
    name: 'an import of the removed socket modules',
    pattern: /socket\/(client|listener|serve)\b/,
  },
];

/** The production `.ts` files under `apps/<app>/src`, relative to the repository root. */
const productionSources = (): string[] =>
  APPS.flatMap((app) =>
    (
      readdirSync(join(ROOT, 'apps', app, 'src'), {
        recursive: true,
      }) as string[]
    )
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => !file.split(/[\\/]/).includes('__tests__'))
      .map((file) => join('apps', app, 'src', file)),
  );

describe('the HTTP-only transport', () => {
  it('reads production sources from every app, so the guard is not empty', () => {
    const files = productionSources();

    expect(files.some((file) => file.endsWith('main.ts'))).toBe(true);
    expect(files.length).toBeGreaterThan(50);
  });

  it('keeps no Unix socket code in any app source', () => {
    const offences: string[] = [];
    for (const file of productionSources()) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(text)) {
          offences.push(`${relative(ROOT, join(ROOT, file))}: ${name}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
