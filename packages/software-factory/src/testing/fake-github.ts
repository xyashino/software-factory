import type { GithubPort, PrRef } from '../ports/github.port';

/** In-memory GitHub: pull requests are set up by the test. */
export class FakeGithub implements GithubPort {
  readonly prs = new Map<string, PrRef>();
  readonly created: {
    branch: string;
    base: string;
    title: string;
    body: string;
    draft: boolean;
  }[] = [];
  private nextNumber = 1;

  async findPr(branch: string): Promise<PrRef | undefined> {
    return this.prs.get(branch);
  }

  async createPr(input: {
    branch: string;
    base: string;
    title: string;
    body: string;
    draft: boolean;
  }) {
    this.created.push(input);
    const number = this.nextNumber;
    this.nextNumber += 1;
    const pr: PrRef = {
      number,
      url: `https://example.test/pull/${number}`,
      state: 'open',
    };
    this.prs.set(input.branch, pr);
    return { url: pr.url };
  }
}
