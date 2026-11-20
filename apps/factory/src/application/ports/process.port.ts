export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DetachedSpec {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  logPath: string;
}

export interface ProcessPort {
  run(
    command: string,
    args: readonly string[],
    cwd: string,
    env?: Readonly<Record<string, string>>,
  ): Promise<ProcessResult>;
  spawnDetached(spec: DetachedSpec): Promise<number>;
  isAlive(pid: number): boolean;
  terminate(pid: number): void;
  probeUrl(url: string): Promise<boolean>;
}
