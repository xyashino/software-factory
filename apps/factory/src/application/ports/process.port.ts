export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessPort {
  run(
    command: string,
    args: readonly string[],
    cwd: string,
  ): Promise<ProcessResult>;
}
