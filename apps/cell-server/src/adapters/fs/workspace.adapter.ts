import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { BadGateway, Conflict } from '../../application/core/error-handling';
import type { WorkspacePort } from '../../application/ports/workspace.port';
import { WORKSPACE_DIR } from '../../config';

const execGit = promisify(execFile);

const gitOutput = async (cwd: string, args: string[]): Promise<string> =>
  (await execGit('git', args, { cwd })).stdout;

const originOf = async (dir: string): Promise<string | null> => {
  try {
    return (await gitOutput(dir, ['remote', 'get-url', 'origin'])).trim();
  } catch {
    return null;
  }
};

const isCleanOf = async (dir: string): Promise<boolean> =>
  (await gitOutput(dir, ['status', '--porcelain'])) === '';

const cloneInto = async (repoUrl: string, dir: string): Promise<void> => {
  mkdirSync(dirname(dir), { recursive: true });
  try {
    await execGit('git', ['clone', repoUrl, dir]);
  } catch (error) {
    throw new BadGateway(
      `git clone ${repoUrl} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const createWorkspaceAdapter = (
  root: string = WORKSPACE_DIR,
): WorkspacePort => ({
  ensure: async (projectId, repoUrl) => {
    const dir = join(root, projectId);
    if (!existsSync(join(dir, '.git'))) {
      if (existsSync(dir))
        throw new Conflict(`workspace ${dir} exists but is not a git clone`);
      await cloneInto(repoUrl, dir);
      return dir;
    }
    if ((await originOf(dir)) !== repoUrl)
      throw new Conflict(`workspace ${dir} is not a clone of ${repoUrl}`);
    if (!(await isCleanOf(dir)))
      throw new Conflict(`workspace ${dir} has uncommitted changes`);
    return dir;
  },
});
