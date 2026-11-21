import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessRunner } from '../../../../src/adapters/runners/headless';

const KILL_AFTER_MS = 5_000;

const IGNORES_TERM = [
  "process.on('SIGTERM', () => {});",
  "process.stdout.write('ready');",
  'setInterval(() => {}, 1000);',
].join('\n');

const PRINTS_AND_EXITS =
  "process.stdout.write('step done'); process.stderr.write('warn');";

const spec = (script: string, logPath: string) => ({
  command: process.execPath,
  args: ['-e', script],
  cwd: tmpdir(),
  env: {},
  logPath,
});

describe('headless runner', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes stdout and stderr to the step log and reports the exit code', async () => {
    // Arrange
    const logPath = join(
      mkdtempSync(join(tmpdir(), 'headless-')),
      '.cell',
      'build',
      'step.log',
    );
    const runner = createHeadlessRunner();

    // Act
    const handle = await runner.start(spec(PRINTS_AND_EXITS, logPath));
    const outcome = await runner.wait(handle);

    // Assert
    expect(outcome.exitCode).toBe(0);
    expect(readFileSync(logPath, 'utf8')).toBe('step donewarn');
  });

  it('sends SIGTERM on abort and SIGKILL only after five seconds, then confirms the exit', async () => {
    // Arrange
    const logPath = join(mkdtempSync(join(tmpdir(), 'headless-')), 'step.log');
    const runner = createHeadlessRunner();
    const handle = await runner.start(spec(IGNORES_TERM, logPath));
    let finished = false;
    const outcome = runner.wait(handle).then((result) => {
      finished = true;
      return result;
    });
    await vi.waitFor(() =>
      expect(readFileSync(logPath, 'utf8')).toContain('ready'),
    );

    // Act
    const stopped = runner.abort(handle);
    await vi.advanceTimersByTimeAsync(KILL_AFTER_MS - 1);
    const stillRunning = !finished;
    await vi.advanceTimersByTimeAsync(1);
    const gone = await stopped;
    const result = await outcome;

    // Assert
    expect(stillRunning).toBe(true);
    expect(gone).toBe(true);
    expect(result.exitCode).toBe(-1);
  });

  it('stops the agent children with it when the run is aborted', async () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), 'headless-'));
    const childPidFile = join(dir, 'child.pid');
    const script = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      `writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid));`,
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const runner = createHeadlessRunner();
    const handle = await runner.start(spec(script, join(dir, 'step.log')));
    await vi.waitFor(() => expect(existsSync(childPidFile)).toBe(true));
    const childPid = Number(readFileSync(childPidFile, 'utf8'));

    // Act
    const gone = await runner.abort(handle);

    // Assert
    expect(gone).toBe(true);
    await vi.waitFor(() => expect(() => process.kill(childPid, 0)).toThrow());
  });
});
