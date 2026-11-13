export interface CommandResult {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

/** Runs one shell command with a timeout. Output goes to `logPath`. */
export interface SystemPort {
  run(input: {
    command: string;
    cwd: string;
    timeoutMs: number;
    logPath: string;
  }): Promise<CommandResult>;
}
