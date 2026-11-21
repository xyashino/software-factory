import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ProcessPort } from '../../application/ports/process.port';

const INFO_EXCLUDE = 'info/exclude';

export const addInfoExclude = async (
  process: ProcessPort,
  worktree: string,
  pattern: string,
): Promise<void> => {
  const located = await process.run(
    'git',
    ['rev-parse', '--git-path', INFO_EXCLUDE],
    worktree,
  );
  if (located.exitCode !== 0) {
    throw new Error(`git rev-parse failed: ${located.stderr.trim()}`);
  }
  const file = resolve(worktree, located.stdout.trim());
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current.split('\n').includes(pattern)) {
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
  appendFileSync(file, `${separator}${pattern}\n`);
};
