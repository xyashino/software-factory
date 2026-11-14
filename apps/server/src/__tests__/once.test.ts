import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** The server entry point, run as a real process. */
const MAIN = fileURLToPath(new URL('../main.ts', import.meta.url));

let dataDir: string;
const children: Bun.Subprocess[] = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factory-once-'));
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL');
    await child.exited;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

/** Runs `factory-server --once` with one request on stdin and returns its exit code and output. */
const runOnce = async (
  input: string,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const child = Bun.spawn(['bun', MAIN, '--once', '--data-dir', dataDir], {
    env: { ...process.env, FACTORY_DATA_DIR: '' },
    stdin: new Blob([input]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await child.exited;
  return {
    code,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
};

describe('factory-server --once', () => {
  it('runs one read, prints its answer and exits without leaving a socket', async () => {
    const result = await runOnce(
      JSON.stringify({ route: 'board', request: {} }),
    );

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      response: { orders: [] },
    });
    expect(existsSync(join(dataDir, 'factory.sock'))).toBe(false);
  });

  it('refuses an unknown route with exit code 2 and the wire error', async () => {
    const result = await runOnce(
      JSON.stringify({ route: 'no-such-route', request: {} }),
    );

    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('refuses a request that does not match the route schema', async () => {
    const result = await runOnce(
      JSON.stringify({ route: 'cellRevoke', request: { cellId: 'bad' } }),
    );

    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe('invalid');
  });

  it('releases the writer lock on exit so the next one-shot runs', async () => {
    await runOnce(JSON.stringify({ route: 'board', request: {} }));

    const second = await runOnce(
      JSON.stringify({ route: 'board', request: {} }),
    );

    expect(second.code).toBe(0);
  });

  it('exits with code 3 while another process holds the data directory', async () => {
    const holder = Bun.spawn(['bun', MAIN, '--data-dir', dataDir], {
      env: { ...process.env, FACTORY_DATA_DIR: '' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    children.push(holder);
    for (let waited = 0; waited < 10_000; waited += 50) {
      if (existsSync(join(dataDir, 'factory.sock'))) break;
      await Bun.sleep(50);
    }

    const result = await runOnce(
      JSON.stringify({ route: 'board', request: {} }),
    );

    expect(result.code).toBe(3);
    expect(JSON.parse(result.stdout).ok).toBe(false);
  });
});
