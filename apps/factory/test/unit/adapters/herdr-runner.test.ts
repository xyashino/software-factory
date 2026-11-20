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

const TABS = (label: string): string =>
  `{"result":{"tabs":[{"tab_id":"w9:t1","label":"${label}","number":1}]}}`;
const PANES = '{"result":{"panes":[{"pane_id":"w9:p1","tab_id":"w9:t1"}]}}';
const LOG_OPTIONS = { home: '/repo', logPath: '/repo/.factory-local/cell.log' };

const fakeHerdr = (
  statusCode = 0,
  workspaceList = NO_WORKSPACES,
  tabList = TABS('1'),
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
      if (args[0] === 'tab' && args[1] === 'list')
        return { ...OK, stdout: tabList };
      if (args[0] === 'pane' && args[1] === 'list')
        return { ...OK, stdout: PANES };
      return OK;
    },
    spawnDetached: async () => 0,
    isAlive: () => false,
    terminate: () => undefined,
    probeUrl: async () => false,
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

  it('turns the first tab of the cell workspace into a logs tab that follows the cell log', async () => {
    // Arrange
    const { port, calls } = fakeHerdr();
    const runner = createHerdrRunner(port, CELL, LOG_OPTIONS);

    // Act
    await finish(runner, stepDir());

    // Assert
    expect(calls).toContainEqual(['herdr', 'tab', 'rename', 'w9:t1', 'logs']);
    const follow = calls.find(
      (call) => call[1] === 'pane' && call[2] === 'run',
    );
    expect(follow?.[3]).toBe('w9:p1');
    expect(follow?.[4]).toContain(
      "tail -n 200 -F '/repo/.factory-local/cell.log'",
    );
    expect(calls).toContainEqual([
      'herdr',
      'workspace',
      'create',
      '--label',
      'factory:omarchy',
      '--cwd',
      '/repo',
      '--no-focus',
    ]);
  });

  it('leaves an existing logs tab alone', async () => {
    // Arrange
    const { port, calls } = fakeHerdr(0, CELL_WORKSPACE('w9'), TABS('logs'));
    const runner = createHerdrRunner(port, CELL, LOG_OPTIONS);

    // Act
    await finish(runner, stepDir());

    // Assert
    expect(calls.some((call) => call[2] === 'rename')).toBe(false);
  });

  it('opens the Cell workspace and its logs tab on prepare, before any run', async () => {
    // Arrange
    const { port, calls } = fakeHerdr();
    const runner = createHerdrRunner(port, CELL, LOG_OPTIONS);

    // Act
    await runner.prepare();

    // Assert
    expect(
      calls.filter((call) => call[1] === 'workspace' && call[2] === 'create'),
    ).toEqual([
      [
        'herdr',
        'workspace',
        'create',
        '--label',
        'factory:omarchy',
        '--cwd',
        '/repo',
        '--no-focus',
      ],
    ]);
    expect(calls).toContainEqual(['herdr', 'tab', 'rename', 'w9:t1', 'logs']);
    expect(
      calls.some((call) => call[1] === 'tab' && call[2] === 'create'),
    ).toBe(false);
  });

  it('resolves prepare when herdr is down and retries on the first run', async () => {
    // Arrange
    const dir = stepDir();
    const { port, calls } = fakeHerdr();
    let herdrUp = false;
    const flaky: ProcessPort = {
      ...port,
      run: async (command, args, cwd) => {
        if (!herdrUp && args[0] === 'workspace') {
          return { ...OK, exitCode: 1, stderr: 'herdr is down' };
        }
        return port.run(command, args, cwd);
      },
    };
    const runner = createHerdrRunner(flaky, CELL, LOG_OPTIONS);

    // Act
    await expect(runner.prepare()).resolves.toBeUndefined();
    herdrUp = true;
    await finish(runner, dir);

    // Assert
    expect(
      calls.some((call) => call[1] === 'workspace' && call[2] === 'create'),
    ).toBe(true);
    expect(
      calls.some((call) => call[1] === 'tab' && call[2] === 'create'),
    ).toBe(true);
  });
});
