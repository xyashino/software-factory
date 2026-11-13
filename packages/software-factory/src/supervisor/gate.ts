import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { GateFailure } from '../engine/events';
import type { SystemPort } from '../ports/system.port';

/** The most characters of a failing command's output that reach the worker. */
export const GATE_TAIL_CHARS = 12_000;

export interface GateInput {
  exec: readonly string[];
  timeoutMs: number;
  cwd: string;
  /** attempt directory; raw logs are saved here as `<cmdIndex>.log` */
  evidenceDir: string;
  /** progress callback: called before and after each command */
  onCommand?: (progress: GateProgress) => void;
}

export interface GateProgress {
  command: string;
  /** 1-based position of the command */
  index: number;
  total: number;
  /** set once the command has finished */
  result?: { exitCode: number | null; timedOut: boolean };
}

export interface GateResult {
  passed: boolean;
  failures: GateFailure[];
}

/**
 * Runs every command of a gate in order. A failing command does not stop the
 * rest, so the worker sees type, lint and test failures in one round.
 */
export const runGate = async (
  system: SystemPort,
  input: GateInput,
): Promise<GateResult> => {
  const failures: GateFailure[] = [];
  for (const [index, command] of input.exec.entries()) {
    const logPath = join(input.evidenceDir, `${index}.log`);
    const position = {
      command,
      index: index + 1,
      total: input.exec.length,
    };
    input.onCommand?.(position);
    const result = await system.run({
      command,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      logPath,
    });
    input.onCommand?.({
      ...position,
      result: { exitCode: result.exitCode, timedOut: result.timedOut },
    });
    if (result.timedOut || result.exitCode !== 0) {
      failures.push({
        command,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        tail: tailOf(logPath),
        logPath,
      });
    }
  }
  return { passed: failures.length === 0, failures };
};

/** The last 12,000 characters of a log, with terminal control sequences removed. */
export const tailOf = (logPath: string): string => {
  let raw: string;
  try {
    raw = readFileSync(logPath, 'utf8');
  } catch {
    return '';
  }
  return stripVTControlCharacters(raw).slice(-GATE_TAIL_CHARS);
};
