import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHerdrRunner } from '../../../src/adapters/runners/herdr';
import type {
  ProcessPort,
  ProcessResult,
} from '../../../src/application/ports/process.port';
import type { RunSpec } from '../../../src/application/ports/runner.port';

const TAB_ANSWER = '{"result":{"tab_id":"w1:t7","pane_id":"w1:t7:p1"}}';
const OK: ProcessResult = { exitCode: 0, stdout: '', stderr: '' };

interface FakeHerdr {
  port: ProcessPort;
  calls: string[][];
}

const fakeHerdr = (statusCode = 0): FakeHerdr => {
  const calls: string[][] = [];
  const port: ProcessPort = {
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === 'status') return { ...OK, exitCode: statusCode };
      if (args[0] === 'tab' && args[1] === 'create')
        return { ...OK, stdout: TAB_ANSWER };
      return OK;
    },
    spawnDetached: async () => 0,
    isAlive: () => false,
    terminate: () => undefined,
  };
  return { port, calls };
};

const specIn = (stepDir: string): RunSpec => ({
  command: 'claude',
  args: ['Read the prompt.'],
  cwd: stepDir,
  env: { FACTORY_CYCLE_TOKEN: 'token' },
  logPath: join(stepDir, 'step.log'),
  interactive: true,
});

const stepDir = (): string => mkdtempSync(join(tmpdir(), 'herdr-runner-'));

describe('herdr pane runner', () => {
  it('reports herdr as available when its server answers', async () => {
    const { port } = fakeHerdr(0);
    const runner = createHerdrRunner(port);

    expect(await runner.interactiveAvailable()).toBe(true);
  });

  it('reports herdr as unavailable when its server is down', async () => {
    const { port } = fakeHerdr(1);
    const runner = createHerdrRunner(port);

    expect(await runner.interactiveAvailable()).toBe(false);
  });

  it('opens a tab and runs the agent in its pane until the exit code is written', async () => {
    const dir = stepDir();
    const { port, calls } = fakeHerdr();
    const runner = createHerdrRunner(port);
    const handle = await runner.start(specIn(dir));
    writeFileSync(join(dir, `${handle.id}.exit`), '0\n');

    const outcome = await runner.wait(handle);

    expect(outcome.exitCode).toBe(0);
    expect(
      calls.some((call) => call[1] === 'tab' && call[2] === 'create'),
    ).toBe(true);
    expect(calls.some((call) => call[1] === 'pane' && call[2] === 'run')).toBe(
      true,
    );
  });

  it('closes the previous tab when the next run starts', async () => {
    const dir = stepDir();
    const { port, calls } = fakeHerdr();
    const runner = createHerdrRunner(port);
    const first = await runner.start(specIn(dir));
    writeFileSync(join(dir, `${first.id}.exit`), '0\n');
    await runner.wait(first);

    await runner.start(specIn(dir));

    expect(calls).toContainEqual(['herdr', 'tab', 'close', 'w1:t7']);
  });

  it('closes the tab on abort and ends the wait as aborted', async () => {
    const dir = stepDir();
    const { port, calls } = fakeHerdr();
    const runner = createHerdrRunner(port);
    const handle = await runner.start(specIn(dir));

    await runner.abort(handle);
    const outcome = await runner.wait(handle);

    expect(calls).toContainEqual(['herdr', 'tab', 'close', 'w1:t7']);
    expect(outcome.exitCode).toBe(130);
  });
});
