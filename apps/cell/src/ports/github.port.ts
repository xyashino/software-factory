/** A pull request as the Cell reads it from GitHub. `draft` is what `markReady` changes. */
export interface PrRef {
  url: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
}

export interface GithubPort {
  /**
   * The PR whose head is `head`, in any state (merged and closed PRs too). With `base`, only PRs into that
   * branch. When several match, an open one wins. Undefined when none does.
   */
  findPr(head: string, base?: string): Promise<PrRef | undefined>;
  createPr(input: {
    branch: string;
    base: string;
    title: string;
    body: string;
    draft: boolean;
  }): Promise<{ url: string }>;
  /** Marks a draft PR ready for review. A PR that is already ready is left as it is. */
  markReady(prUrl: string): Promise<void>;
  /** Replaces the PR's body. */
  updateBody(prUrl: string, body: string): Promise<void>;
}
