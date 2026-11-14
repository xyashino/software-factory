import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSystemAdapter } from '../system.adapter';

const scratch = (): string => {
  return mkdtempSync(join(tmpdir(), 'sf-system-'));
};

describe('system adapter', () => {
  it('reports the exit code and writes stdout and stderr to the log', async () => {
    const dir = scratch();
    const logPath = join(dir, 'logs', 'out.log');
    const result = await createSystemAdapter().run({
      command: 'echo out-line; echo err-line >&2; exit 3',
      cwd: dir,
      timeoutMs: 10_000,
      logPath,
    });
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    const log = readFileSync(logPath, 'utf8');
    expect(log).toContain('out-line');
    expect(log).toContain('err-line');
  });

  it('kills the whole process group on timeout', async () => {
    const dir = scratch();
    const started = Date.now();
    const result = await createSystemAdapter().run({
      command: 'sleep 30 & sleep 30',
      cwd: dir,
      timeoutMs: 300,
      logPath: join(dir, 'timeout.log'),
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('stops a running command as soon as its signal aborts', async () => {
    const dir = scratch();
    const controller = new AbortController();
    const started = Date.now();
    const running = createSystemAdapter().run({
      command: 'sleep 30',
      cwd: dir,
      timeoutMs: 60_000,
      logPath: join(dir, 'abort.log'),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    const result = await running;
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
