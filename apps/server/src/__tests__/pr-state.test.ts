import { describe, expect, it } from 'vitest';
import { ghPrState } from '../adapters/pr-state';

interface Listing {
  url: string;
  state: string;
}

const pr = (repo: string, number: number, state = 'OPEN'): Listing => ({
  url: `https://github.com/${repo}/pull/${number}`,
  state,
});

/**
 * A stand-in for the `gh` CLI: `lists` answers `gh pr list` per repository (an Error fails it), and
 * `views` answers `gh pr view` per URL. Every call is recorded.
 */
const fakeGh = (options: {
  lists?: Record<string, Listing[] | Error>;
  views?: Record<string, string>;
  delayMs?: number;
}) => {
  const calls: string[][] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const run = async (argv: readonly string[]): Promise<string> => {
    calls.push([...argv]);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
      if (argv[2] === 'list') {
        const repo = argv[argv.indexOf('--repo') + 1] ?? '';
        const listing = options.lists?.[repo] ?? [];
        if (listing instanceof Error) throw listing;
        return JSON.stringify(listing);
      }
      const url = argv[3] ?? '';
      const state = options.views?.[url];
      if (state === undefined) throw new Error(`no view for ${url}`);
      return `${state}\n`;
    } finally {
      inFlight -= 1;
    }
  };
  return {
    run,
    calls,
    maxInFlight: () => maxInFlight,
    callsTo: (sub: string) => calls.filter((argv) => argv[2] === sub),
  };
};

describe('GitHub PR states in one batch', () => {
  it('reads the PRs of each repository with one list call, and no view call', async () => {
    const gh = fakeGh({
      lists: {
        'example/app': [
          pr('example/app', 1, 'OPEN'),
          pr('example/app', 2, 'MERGED'),
        ],
        'example/lib': [pr('example/lib', 5, 'CLOSED')],
      },
    });

    const states = await ghPrState(gh.run).readMany([
      'https://github.com/example/app/pull/1',
      'https://github.com/example/app/pull/2',
      'https://github.com/example/lib/pull/5',
    ]);

    expect(Object.fromEntries(states)).toEqual({
      'https://github.com/example/app/pull/1': 'open',
      'https://github.com/example/app/pull/2': 'merged',
      'https://github.com/example/lib/pull/5': 'closed',
    });
    expect(gh.callsTo('list')).toHaveLength(2);
    expect(gh.callsTo('view')).toEqual([]);
  });

  it('reads with gh pr view a PR that its repository list does not hold', async () => {
    const gh = fakeGh({
      lists: { 'example/app': [pr('example/app', 1)] },
      views: { 'https://github.com/example/app/pull/9': 'merged' },
    });

    const states = await ghPrState(gh.run).readMany([
      'https://github.com/example/app/pull/1',
      'https://github.com/example/app/pull/9',
    ]);

    expect(states.get('https://github.com/example/app/pull/9')).toBe('merged');
    expect(gh.callsTo('view')).toEqual([
      [
        'gh',
        'pr',
        'view',
        'https://github.com/example/app/pull/9',
        '--json',
        'state',
        '--jq',
        '.state',
      ],
    ]);
  });

  it('leaves out the PRs of a repository whose list fails, and keeps the other repositories', async () => {
    const gh = fakeGh({
      lists: {
        'example/app': new Error('gh: not authorised'),
        'example/lib': [pr('example/lib', 5, 'OPEN')],
      },
    });

    const states = await ghPrState(gh.run).readMany([
      'https://github.com/example/app/pull/1',
      'https://github.com/example/lib/pull/5',
    ]);

    expect(Object.fromEntries(states)).toEqual({
      'https://github.com/example/lib/pull/5': 'open',
    });
    expect(gh.callsTo('view')).toEqual([]);
  });

  it('never has more than four gh processes in flight', async () => {
    const repos = ['a', 'b', 'c', 'd', 'e', 'f'].map(
      (name) => `example/${name}`,
    );
    const gh = fakeGh({
      lists: Object.fromEntries(repos.map((repo) => [repo, [pr(repo, 1)]])),
      delayMs: 5,
    });

    const states = await ghPrState(gh.run).readMany(
      repos.map((repo) => `https://github.com/${repo}/pull/1`),
    );

    expect(states.size).toBe(repos.length);
    expect(gh.callsTo('list')).toHaveLength(repos.length);
    expect(gh.maxInFlight()).toBeGreaterThan(1);
    expect(gh.maxInFlight()).toBeLessThanOrEqual(4);
  });

  it('starts no gh process when there is no PR to read', async () => {
    const gh = fakeGh({});

    const states = await ghPrState(gh.run).readMany([]);

    expect(states.size).toBe(0);
    expect(gh.calls).toEqual([]);
  });
});
