export interface PrRef {
  number: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
}

export interface GithubPort {
  findPr(branch: string): Promise<PrRef | undefined>;
  createPr(input: {
    branch: string;
    base: string;
    title: string;
    body: string;
    draft: boolean;
  }): Promise<{ url: string }>;
}
