import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommandResult, SystemPort } from '../../ports/system.port';
import { GATE_TAIL_CHARS, runGate } from '../gate';

/** Scripted system: each command gets a result and writes its scripted output to the log. */
class ScriptedSystem implements SystemPort {
  readonly commands: string[] = [];
  constructor(
    private readonly script: Record<
      string,
      { result: Omit<CommandResult, 'durationMs'>; output: string }
    >,
  ) {}

  async run(input: {
    command: string;
    cwd: string;
    timeoutMs: number;
    logPath: string;
  }): Promise<CommandResult> {
    this.commands.push(input.command);
    const entry = this.script[input.command] ?? {
      result: { exitCode: 0, timedOut: false },
      output: '',
    };
    writeFileSync(input.logPath, entry.output);
    return { ...entry.result, durationMs: 1 };
  }
}

const evidenceDir = (): string => mkdtempSync(join(tmpdir(), 'sf-gate-'));

describe('runGate', () => {
  it('runs every command even after an earlier failure', async () => {
    const system = new ScriptedSystem({
      'pnpm check-types': {
        result: { exitCode: 2, timedOut: false },
        output: 'type error',
      },
      'pnpm lint': { result: { exitCode: 0, timedOut: false }, output: '' },
      'pnpm test': {
        result: { exitCode: 1, timedOut: false },
        output: 'test failed',
      },
    });
    const result = await runGate(system, {
      exec: ['pnpm check-types', 'pnpm lint', 'pnpm test'],
      timeoutMs: 1000,
      cwd: '/repo',
      evidenceDir: evidenceDir(),
    });
    expect(system.commands).toEqual([
      'pnpm check-types',
      'pnpm lint',
      'pnpm test',
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.command)).toEqual([
      'pnpm check-types',
      'pnpm test',
    ]);
    expect(result.failures[0]?.exitCode).toBe(2);
    expect(result.failures[0]?.tail).toBe('type error');
  });

  it('passes when every command exits zero', async () => {
    const result = await runGate(new ScriptedSystem({}), {
      exec: ['a', 'b'],
      timeoutMs: 1000,
      cwd: '/repo',
      evidenceDir: evidenceDir(),
    });
    expect(result).toEqual({ passed: true, failures: [] });
  });

  it('strips ANSI codes and keeps only the last 12,000 characters', async () => {
    const noisy = `\u001b[31mHEAD\u001b[0m${'x'.repeat(20_000)}END`;
    const result = await runGate(
      new ScriptedSystem({
        boom: { result: { exitCode: 1, timedOut: false }, output: noisy },
      }),
      {
        exec: ['boom'],
        timeoutMs: 1000,
        cwd: '/repo',
        evidenceDir: evidenceDir(),
      },
    );
    const tail = result.failures[0]?.tail ?? '';
    expect(tail).toHaveLength(GATE_TAIL_CHARS);
    expect(tail.endsWith('END')).toBe(true);
    expect(tail).not.toContain('\u001b');
    expect(tail).not.toContain('HEAD');
  });

  it('records timed-out commands with a null exit code', async () => {
    const result = await runGate(
      new ScriptedSystem({
        slow: { result: { exitCode: null, timedOut: true }, output: '' },
      }),
      {
        exec: ['slow'],
        timeoutMs: 1,
        cwd: '/repo',
        evidenceDir: evidenceDir(),
      },
    );
    expect(result.failures).toEqual([
      expect.objectContaining({
        command: 'slow',
        exitCode: null,
        timedOut: true,
      }),
    ]);
  });
});
