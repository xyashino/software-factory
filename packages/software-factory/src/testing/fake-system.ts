import type { CommandResult, SystemPort } from '../ports/system.port';

export interface SystemCall {
  command: string;
  cwd: string;
  timeoutMs: number;
  logPath: string;
}

/** Commands answer from `results`, keyed by command text; unknown commands succeed. */
export class FakeSystem implements SystemPort {
  readonly calls: SystemCall[] = [];
  readonly results = new Map<string, CommandResult>();

  async run(input: SystemCall): Promise<CommandResult> {
    this.calls.push(input);
    return (
      this.results.get(input.command) ?? {
        exitCode: 0,
        timedOut: false,
        durationMs: 0,
      }
    );
  }
}
