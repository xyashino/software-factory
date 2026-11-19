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
const CREATED_WORKSPACE = '{"result":{"workspace_id":"w9"}}';
const NO_WORKSPACES = '{"result":{"workspaces":[]}}';
const CELL_WORKSPACE = (id: string): string =>
  `{"result":{"workspaces":[{"label":"factory:omarchy","workspace_id":"${id}"}]}}`;
const CELL = async (): Promise<string> => 'omarchy';
const OK: ProcessResult = { exitCode: 0, stdout: '', stderr: '' };

interface FakeHerdr {
  port: ProcessPort;
  calls: string[][];
}

const fakeHerdr = (
  statusCode = 0,
  workspaceList = NO_WORKSPACES,
): FakeHerdr => {
  const calls: string[][] = [];
  const port: ProcessPort = {
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === 'status') return { ...OK, exitCode: statusCode };
      if (args[0] === 'workspace' && args[1] === 'list')
        return { ...OK, stdout: workspaceList };
      if (args[0] === 'workspace' && args[1] === 'create')
        return { ...OK, stdout: CREATED_WORKSPACE };
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

const finish = async (
  runner: ReturnType<typeof createHerdrRunner>,
  dir: string,
): Promise<void> => {
  const handle = await runner.start(specIn(dir));
  writeFileSync(join(dir, `${handle.id}.exit`), '0\n');
  await runner.wait(handle);
};

describe('herdr pane runner', () => {
  it('reports herdr as available when its server answers', async () => {
    const { port } = fakeHerdr(0);
    const runner = createHerdrRunner(port, CELL);

    expect(await runner.interactiveAvailable()).toBe(true);
  });

  it('reports herdr as unavailable when its server is down', async () => {
    const { port } = fakeHerdr(1);
    const runner = createHerdrRunner(port, CELL);

    expect(await runner.interactiveAvailable()).toBe(false);
  });

  it('opens a tab and runs the agent in its pane until the exit code is written', async () => {
    const dir = stepDir();
    const { port, calls } = fakeHerdr();
    const runner = createHerdrRunner(port, CELL);
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

  it('creates the Cell workspace once and opens every step tab in it', async () => {
    const { port, calls } = fakeHerdr();
    const runner = createHerdrRunner(port, CELL);

    await finish(runner, stepDir());
    await finish(runner, stepDir());

    const creates = calls.filter(
      (call) => call[1] === 'workspace' && call[2] === 'create',
    );
    const tabCreates = calls.filter(
      (call) => call[1] === 'tab' && call[2] === 'create',
    );
    expect(creates).toEqual([
      [
        'herdr',
        'workspace',
        'create',
        '--label',
        'factory:omarchy',
        '--cwd',
        expect.any(String),
        '--no-focus',
      ],
    ]);
    expect(tabCreates).toHaveLength(2);
    for (const call of tabCreates) {
      expect(call).toContain('w9');
    }
  });

  it('adopts the Cell workspace that already exists instead of creating one', async () => {
    const { port, calls } = fakeHerdr(0, CELL_WORKSPACE('w5'));
    const runner = createHerdrRunner(port, CELL);

    await finish(runner, stepDir());

    expect(
      calls.some((call) => call[1] === 'workspace' && call[2] === 'create'),
    ).toBe(false);
    expect(
      calls.find((call) => call[2] === 'create' && call[1] === 'tab'),
    ).toContain('w5');
  });

  it('closes the previous tab when the next run starts', async () => {
    const dir = stepDir();
    const { port, calls } = fakeHerdr();
    const runner = createHerdrRunner(port, CELL);
    const first = await runner.start(specIn(dir));
    writeFileSync(join(dir, `${first.id}.exit`), '0\n');
    await runner.wait(first);

    await runner.start(specIn(dir));

    expect(calls).toContainEqual(['herdr', 'tab', 'close', 'w1:t7']);
  });

  it('closes the tab on abort and ends the wait as aborted', async () => {
    const dir = stepDir();
    const { port, calls } = fakeHerdr();
    const runner = createHerdrRunner(port, CELL);
    const handle = await runner.start(specIn(dir));

    await runner.abort(handle);
    const outcome = await runner.wait(handle);

    expect(calls).toContainEqual(['herdr', 'tab', 'close', 'w1:t7']);
    expect(outcome.exitCode).toBe(130);
  });
});
