export interface CommandResult {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Runs one shell command with a timeout. Output goes to `logPath`. An `abort` of `signal` kills the
 * whole process group at once (self-fence, stale job), the same way a timeout does.
 */
export interface SystemPort {
  run(input: {
    command: string;
    cwd: string;
    timeoutMs: number;
    logPath: string;
    signal?: AbortSignal;
  }): Promise<CommandResult>;
}
