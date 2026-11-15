import { execFile } from 'node:child_process';

/**
 * The repository's `origin` url (`git -C <repoDir> remote get-url origin`), or undefined when the
 * repository has no origin remote. The arguments go as a vector: no shell.
 */
export const repoOriginUrl = (repoDir: string): Promise<string | undefined> =>
  new Promise((resolve) => {
    execFile(
      'git',
      ['-C', repoDir, 'remote', 'get-url', 'origin'],
      { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout) => {
        const url = String(stdout).trim();
        resolve(error === null && url !== '' ? url : undefined);
      },
    );
  });
