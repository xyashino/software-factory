import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SystemPort } from '../ports/system.port';

/** How a workspace step runs commands: through the system port, logs under `logDir`, cancelled by `signal`. */
export interface ShellContext {
  system: SystemPort;
  logDir: string;
  signal?: AbortSignal;
}

/** One finished command: its exit, and its output (stdout and stderr, interleaved, as bytes). */
export interface ShellRun {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  output: Uint8Array;
}

const decoder = new TextDecoder();

/** Quotes one argument for `bash -lc`: single quotes, with embedded quotes escaped. */
export const shellQuote = (arg: string): string =>
  `'${arg.replace(/'/g, `'\\''`)}'`;

/** The git command line for `args`, every argument quoted. */
export const gitCommand = (args: readonly string[]): string =>
  ['git', ...args.map(shellQuote)].join(' ');

/** Runs one command in `cwd` and returns its exit and output. Output is kept in its own log file. */
export const runShell = async (
  ctx: ShellContext,
  input: { command: string; cwd: string; timeoutMs: number },
): Promise<ShellRun> => {
  mkdirSync(ctx.logDir, { recursive: true });
  const logPath = join(ctx.logDir, `${randomUUID()}.log`);
  const result = await ctx.system.run({
    command: input.command,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    logPath,
    signal: ctx.signal,
  });
  return {
    command: input.command,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    output: new Uint8Array(readFileSync(logPath)),
  };
};

/** Whether a run exited 0 without timing out. */
export const succeeded = (run: ShellRun): boolean =>
  run.exitCode === 0 && !run.timedOut;

/** The run's output as text, for messages and for `git rev-parse` style answers. */
export const textOf = (run: ShellRun): string => decoder.decode(run.output);

/** A failure line for a run: the command and how it ended. */
export const describeFailure = (run: ShellRun, timeoutMs: number): string =>
  run.timedOut
    ? `${run.command} timed out after ${timeoutMs} ms`
    : `${run.command} exited ${run.exitCode ?? 'without a code'}`;
