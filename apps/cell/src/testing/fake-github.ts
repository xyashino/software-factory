import type { GithubPort, PrRef } from '../ports/github.port';

/** A PR the fake holds: its head and base, and the PR as `findPr` reports it. */
export interface FakePr extends PrRef {
  head: string;
  base: string;
}

/** The fake's record of what the code under test asked GitHub to do. */
export interface FakeGithub extends GithubPort {
  /** The PRs the fake holds, in creation order. */
  readonly prs: FakePr[];
  /** Every `createPr` call, in order. */
  readonly created: {
    branch: string;
    base: string;
    title: string;
    body: string;
    draft: boolean;
  }[];
  /** The PR urls `markReady` really changed (a draft that became ready). */
  readonly readied: string[];
  /** The last body each PR was given, by url. */
  readonly bodies: Map<string, string>;
  /** Adds a PR that already exists on GitHub (a pre-seeded merged PR, say). */
  seed(pr: FakePr): void;
}

/** An in-memory GitHub, keyed by head and base, for tests. Records every call the code makes. */
export const fakeGithub = (): FakeGithub => {
  const prs: FakePr[] = [];
  const created: FakeGithub['created'] = [];
  const readied: string[] = [];
  const bodies = new Map<string, string>();
  let next = 1;

  const find = (head: string, base?: string): FakePr | undefined => {
    const matching = prs.filter(
      (pr) => pr.head === head && (base === undefined || pr.base === base),
    );
    return matching.find((pr) => pr.state === 'open') ?? matching[0];
  };
  const refOf = (pr: FakePr): PrRef => ({
    url: pr.url,
    state: pr.state,
    draft: pr.draft,
  });

  return {
    prs,
    created,
    readied,
    bodies,
    seed: (pr) => {
      prs.push(pr);
    },
    async findPr(head, base) {
      const pr = find(head, base);
      return pr ? refOf(pr) : undefined;
    },
    async createPr(input) {
      created.push(input);
      const url = `https://example.test/software-factory/pull/${next}`;
      next += 1;
      prs.push({
        url,
        state: 'open',
        draft: input.draft,
        head: input.branch,
        base: input.base,
      });
      return { url };
    },
    async markReady(prUrl) {
      const pr = prs.find((candidate) => candidate.url === prUrl);
      if (!pr) throw new Error(`no fake PR ${prUrl}`);
      if (!pr.draft) return;
      pr.draft = false;
      readied.push(prUrl);
    },
    async updateBody(prUrl, body) {
      if (!prs.some((candidate) => candidate.url === prUrl)) {
        throw new Error(`no fake PR ${prUrl}`);
      }
      bodies.set(prUrl, body);
    },
  };
};
