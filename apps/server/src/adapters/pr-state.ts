import type {
  PrForBranch,
  PrState,
  PrStatePort,
} from '@repo/factory-core/ports/pr-state';
import { runProcess } from './run';

const STATES = new Set<PrState>(['open', 'merged', 'closed']);

/** Pull requests one `gh pr list` returns for a repository; a PR past this is read with `gh pr view`. */
const LIST_LIMIT = 1000;
/** Most `gh` processes in flight at once when many repositories or pull requests are read. */
const CONCURRENCY = 4;

/** `owner/repo` for a GitHub URL; any other repository is passed to `gh` as it is. */
const repoOf = (repoUrl: string): string => {
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(repoUrl);
  return match?.[1] ?? repoUrl;
};

/** `owner/repo` of a GitHub pull request URL, or undefined for any other URL. */
const prRepoOf = (prUrl: string): string | undefined =>
  /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+\/?$/.exec(prUrl)?.[1];

/** Runs `task` on every item with at most `limit` in flight. */
const bounded = async <T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await task(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
};

/**
 * Pull request state through the GitHub CLI. The CLI must be installed and authenticated for the
 * account that runs the server. `read` runs `gh pr view` for one PR. `readMany` runs one
 * `gh pr list --state all` per repository, with at most four in flight, and `gh pr view` only for the
 * PRs a list does not hold; a repository whose list fails leaves its PRs out of the result.
 */
export const ghPrState = (
  run: (argv: readonly string[]) => Promise<string> = runProcess,
): PrStatePort => {
  const read = async (prUrl: string): Promise<PrState> => {
    const state = (
      await run([
        'gh',
        'pr',
        'view',
        prUrl,
        '--json',
        'state',
        '--jq',
        '.state',
      ])
    )
      .trim()
      .toLowerCase();
    if (!STATES.has(state as PrState)) {
      throw new Error(
        `gh reported an unknown PR state "${state}" for ${prUrl}`,
      );
    }
    return state as PrState;
  };

  const listOf = async (repo: string): Promise<Map<string, PrState>> => {
    const listed = await run([
      'gh',
      'pr',
      'list',
      '--repo',
      repo,
      '--state',
      'all',
      '--limit',
      String(LIST_LIMIT),
      '--json',
      'url,state',
    ]);
    const states = new Map<string, PrState>();
    for (const pr of JSON.parse(listed) as { url: string; state: string }[]) {
      const state = pr.state.toLowerCase();
      if (STATES.has(state as PrState)) states.set(pr.url, state as PrState);
    }
    return states;
  };

  return {
    forBranch: async (repoUrl, branch): Promise<PrForBranch | undefined> => {
      const listed = await run([
        'gh',
        'pr',
        'list',
        '--repo',
        repoOf(repoUrl),
        '--head',
        branch,
        '--state',
        'all',
        '--json',
        'url,state',
      ]);
      const found: PrForBranch[] = (
        JSON.parse(listed) as { url: string; state: string }[]
      ).flatMap((pr) => {
        const state = pr.state.toLowerCase();
        return STATES.has(state as PrState)
          ? [{ prUrl: pr.url, state: state as PrState }]
          : [];
      });
      return found.find((pr) => pr.state === 'open') ?? found[0];
    },
    read,
    readMany: async (prUrls) => {
      const byRepo = new Map<string, string[]>();
      const misses: string[] = [];
      for (const prUrl of new Set(prUrls)) {
        const repo = prRepoOf(prUrl);
        if (repo === undefined) {
          misses.push(prUrl);
          continue;
        }
        byRepo.set(repo, [...(byRepo.get(repo) ?? []), prUrl]);
      }

      const found = new Map<string, PrState>();
      await bounded([...byRepo], CONCURRENCY, async ([repo, urls]) => {
        let states: Map<string, PrState>;
        try {
          states = await listOf(repo);
        } catch {
          // The repository's list failed: its PRs are left out, and the next pass asks again.
          return;
        }
        for (const prUrl of urls) {
          const state = states.get(prUrl);
          if (state === undefined) misses.push(prUrl);
          else found.set(prUrl, state);
        }
      });

      await bounded(misses, CONCURRENCY, async (prUrl) => {
        try {
          found.set(prUrl, await read(prUrl));
        } catch {
          // Left out, as above: a PR that cannot be read is not recorded.
        }
      });
      return found;
    },
  };
};
