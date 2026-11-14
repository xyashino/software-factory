export interface SpawnInput {
  /** argv, run without a shell: the binary first */
  command: string[];
  cwd: string;
  /** added to the supervisor's own environment */
  env: Record<string, string>;
  timeoutMs: number;
  stdoutPath: string;
  stderrPath: string;
}

export interface SpawnExit {
  /** null when the process was killed by the timeout */
  exitCode: number | null;
  timedOut: boolean;
}

export interface SpawnedProcess {
  pid: number;
  /** settles when the process ends; never rejects */
  exit: Promise<SpawnExit>;
}

/** Starts a long-running process without waiting for it. Output goes to files. */
export interface ProcessPort {
  spawn(input: SpawnInput): SpawnedProcess;
  /** kills the process group of `pid`; a process that is already gone is fine */
  kill(pid: number): void;
}
