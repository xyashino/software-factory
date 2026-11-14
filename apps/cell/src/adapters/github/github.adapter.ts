import { execFile } from 'node:child_process';
import { z } from 'zod';
import type { GithubPort, PrRef } from '../../ports/github.port';

const prListSchema = z.array(
  z.object({
    url: z.string().min(1),
    state: z.string(),
    isDraft: z.boolean(),
  }),
);

const prViewSchema = z.object({ isDraft: z.boolean() });

export const execGh: GhRunner = (args, cwd, input) =>
  new Promise((resolve) => {
    const child = execFile(
      'gh',
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs `gh` with an argument array (no shell), with `input` on its stdin when given. Never throws;
 * callers check `code`.
 */
export type GhRunner = (
  args: string[],
  cwd: string,
  input?: string,
) => Promise<GhResult>;

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
    async findPr(head, base) {
      // Every state: a merged or closed PR is found too, so the plan can tell it apart from no PR.
      const result = await run(
        [
          'pr',
          'list',
          '--head',
          head,
          ...(base === undefined ? [] : ['--base', base]),
          '--state',
          'all',
          '--json',
          'url,state,isDraft',
        ],
        cwd,
      );
      requireOk('gh pr list', result);
      const found = prListSchema
        .parse(JSON.parse(result.stdout))
        .map((pr): PrRef => ({
          url: pr.url,
          state: toPrState(pr.state),
          draft: pr.isDraft,
        }));
      return found.find((pr) => pr.state === 'open') ?? found[0];
    },

    async markReady(prUrl) {
      const view = await run(['pr', 'view', prUrl, '--json', 'isDraft'], cwd);
      requireOk('gh pr view', view);
      if (!prViewSchema.parse(JSON.parse(view.stdout)).isDraft) return;
      const ready = await run(['pr', 'ready', prUrl], cwd);
      requireOk('gh pr ready', ready);
    },

    async updateBody(prUrl, body) {
      // The body goes on stdin, so no text is ever part of a command line.
      const result = await run(
        ['pr', 'edit', prUrl, '--body-file', '-'],
        cwd,
        body,
      );
      requireOk('gh pr edit', result);
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
