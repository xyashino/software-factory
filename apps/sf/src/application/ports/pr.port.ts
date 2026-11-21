export interface PrSpec {
  cwd: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
}

export interface PrPort {
  publish(spec: PrSpec): Promise<void>;
}
