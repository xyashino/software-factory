import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** STRUCTURE §2: the runtime opens no listener. Only apps/server serves a socket. */
const TRANSPORT = /\b(Bun\.serve|node:http|node:https|node:net|hono)\b/;

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Non-test source files under src/. */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });

describe('factory-runtime is transport-free', () => {
  it('has sources to scan', () => {
    expect(sourceFiles(SRC_DIR).length).toBeGreaterThan(0);
  });

  it('contains no HTTP, TCP or socket listener code', () => {
    const offenders = sourceFiles(SRC_DIR).filter((file) =>
      TRANSPORT.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
