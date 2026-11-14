import { execFile } from 'node:child_process';
import { z } from 'zod';
import type { GithubPort, PrRef } from '../../ports/github.port';

const prListSchema = z.array(
  z.object({
    number: z.number().int(),
    url: z.string().min(1),
    state: z.string(),
  }),
);

export const execGh: GhRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile(
      'gh',
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `gh` with an argument array (no shell). Never throws; callers check `code`. */
export type GhRunner = (args: string[], cwd: string) => Promise<GhResult>;

const requireOk = (what: string, result: GhResult): void => {
  if (result.code !== 0) {
    throw new Error(`${what} failed: ${result.stderr || result.stdout}`);
  }
};

const toPrState = (state: string): PrRef['state'] => {
  const lower = state.toLowerCase();
  if (lower === 'merged') return 'merged';
  if (lower === 'closed') return 'closed';
  return 'open';
};

/**
 * GitHub through the `gh` CLI. `cwd` is any directory of the target repository;
 * `run` is the seam tests replace with canned output.
 */
export const createGithubAdapter = (
  cwd: string,
  run: GhRunner = execGh,
): GithubPort => {
  return {
    async findPr(branch) {
      const result = await run(
        ['pr', 'list', '--head', branch, '--json', 'number,url,state'],
        cwd,
      );
      requireOk('gh pr list', result);
      const [first] = prListSchema.parse(JSON.parse(result.stdout));
      if (first === undefined) return undefined;
      const pr: PrRef = {
        number: first.number,
        url: first.url,
        state: toPrState(first.state),
      };
      return pr;
    },

    async createPr({ branch, base, title, body, draft }) {
      const result = await run(
        [
          'pr',
          'create',
          '--head',
          branch,
          '--base',
          base,
          '--title',
          title,
          '--body',
          body,
          ...(draft ? ['--draft'] : []),
        ],
        cwd,
      );
      requireOk('gh pr create', result);
      const url = result.stdout.trim().split('\n').at(-1)?.trim() ?? '';
      if (url === '') throw new Error('gh pr create printed no PR url');
      return { url };
    },
  };
};
