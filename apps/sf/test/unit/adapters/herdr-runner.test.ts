import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
const logOptionsIn = (dir: string) => ({
  home: '/repo',
  logPath: join(dir, 'cells', 'omarchy.log'),
});
const LOG_OPTIONS = logOptionsIn(mkdtempSync(join(tmpdir(), 'herdr-logs-')));

const LAUNCHER_PID = 100;

const fakeHerdr = (
  statusCode = 0,
  workspaceList = NO_WORKSPACES,
  tabList = TABS('1'),
  recordsPid = true,
): FakeHerdr => {
  const calls: string[][] = [];
  let launches = 0;
  const port: ProcessPort = {
    run: async (command, args, cwd) => {
      calls.push([command, ...args]);
      if (
        args[0] === 'pane' &&
        args[1] === 'run' &&
        args[3]?.startsWith('bash ')
      ) {
        launches += 1;
        if (recordsPid) {
          writeFileSync(
            join(cwd, `herdr-${launches}.pid`),
            `${LAUNCHER_PID}\n`,
          );
        }
      }
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

  it('hands back the launcher pid once the pane runs it', async () => {
    // Arrange
    const dir = stepDir();
    const { port } = fakeHerdr();
    const runner = createHerdrRunner(port, CELL);

    // Act
    const handle = await runner.start(specIn(dir));

    // Assert
    expect(handle.pid).toBe(LAUNCHER_PID);
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

  it('does not close a kept tab when the next run starts', async () => {
    // Arrange
    const dir = stepDir();
    const { port, calls } = fakeHerdr();
    const runner = createHerdrRunner(port, CELL);
    const first = await runner.start(specIn(dir));
    await runner.abort(first, { keepPane: true });

    // Act
    await runner.start(specIn(dir));

    // Assert
    expect(calls).not.toContainEqual(['herdr', 'tab', 'close', 'w1:t7']);
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
    expect(follow?.[4]).toContain(`tail -n 200 -F '${LOG_OPTIONS.logPath}'`);
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

  it('creates the cell log before the logs tab follows it', async () => {
    // Arrange
    const { port, calls } = fakeHerdr();
    const runner = createHerdrRunner(port, CELL, LOG_OPTIONS);

    // Act
    await finish(runner, stepDir());

    // Assert
    const follow = calls.find(
      (call) => call[1] === 'pane' && call[2] === 'run',
    );
    expect(follow?.[4]).toContain(
      `mkdir -p '${dirname(LOG_OPTIONS.logPath)}' && touch '${LOG_OPTIONS.logPath}' && `,
    );
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

  it('creates the cell log before the logs tab follows it, so tail starts without a missing-file warning', async () => {
    // Arrange
    const options = logOptionsIn(stepDir());
    const { port } = fakeHerdr();
    const runner = createHerdrRunner(port, CELL, options);

    // Act
    await runner.prepare();

    // Assert
    expect(readFileSync(options.logPath, 'utf8')).toBe('');
  });

  it('keeps the cell log content that already exists when the logs tab opens', async () => {
    // Arrange
    const options = logOptionsIn(stepDir());
    mkdirSync(dirname(options.logPath), { recursive: true });
    writeFileSync(options.logPath, 'earlier line\n');
    const { port } = fakeHerdr();
    const runner = createHerdrRunner(port, CELL, options);

    // Act
    await runner.prepare();

    // Assert
    expect(readFileSync(options.logPath, 'utf8')).toBe('earlier line\n');
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

const AGENT_TREE = ['  100     1', '  200   100', '  300   200'].join('\n');

const processTree = (
  ignoresTerm: readonly number[] = [],
  ignoresKill: readonly number[] = [],
  recordsPid = true,
) => {
  const { port: herdr, calls } = fakeHerdr(
    0,
    NO_WORKSPACES,
    TABS('1'),
    recordsPid,
  );
  const alive = new Set([100, 200, 300]);
  const kills: string[][] = [];
  const port: ProcessPort = {
    ...herdr,
    run: async (command, args, cwd) => {
      if (command === 'ps') return { ...OK, stdout: AGENT_TREE };
      if (command === 'kill') {
        const [signal, ...pids] = args;
        kills.push([signal, ...pids]);
        for (const pid of pids.map(Number)) {
          const survives =
            signal === '-KILL'
              ? ignoresKill.includes(pid)
              : ignoresTerm.includes(pid);
          if (!survives) alive.delete(pid);
        }
        return OK;
      }
      return herdr.run(command, args, cwd);
    },
    isAlive: (pid) => alive.has(pid),
  };
  return { port, calls, kills };
};

const startWithPid = async (
  runner: ReturnType<typeof createHerdrRunner>,
  dir: string,
): Promise<{ id: string }> => {
  const handle = await runner.start(specIn(dir));
  writeFileSync(join(dir, `${handle.id}.pid`), '100\n');
  return handle;
};

describe('herdr pane runner abort', () => {
  it('stops the whole agent process tree and confirms it is gone', async () => {
    // Arrange
    const dir = stepDir();
    const { port, calls, kills } = processTree();
    const runner = createHerdrRunner(port, CELL);
    const handle = await startWithPid(runner, dir);

    // Act
    const gone = await runner.abort(handle);

    // Assert
    expect(gone).toBe(true);
    expect(kills).toEqual([['-TERM', '100', '200', '300']]);
    expect(calls).toContainEqual(['herdr', 'tab', 'close', 'w1:t7']);
  });

  it('stops the agent but keeps its tab open when asked to keep the pane', async () => {
    // Arrange
    const dir = stepDir();
    const { port, calls, kills } = processTree();
    const runner = createHerdrRunner(port, CELL);
    const handle = await startWithPid(runner, dir);

    // Act
    const gone = await runner.abort(handle, { keepPane: true });

    // Assert
    expect(gone).toBe(true);
    expect(kills).toEqual([['-TERM', '100', '200', '300']]);
    expect(calls).not.toContainEqual(['herdr', 'tab', 'close', 'w1:t7']);
  });

  it('escalates to SIGKILL when the tree ignores SIGTERM', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const dir = stepDir();
    const { port, kills } = processTree([300]);
    const runner = createHerdrRunner(port, CELL);
    const handle = await startWithPid(runner, dir);

    // Act
    const stopped = runner.abort(handle);
    await vi.advanceTimersByTimeAsync(10_000);
    const gone = await stopped;
    vi.useRealTimers();

    // Assert
    expect(gone).toBe(true);
    expect(kills).toEqual([
      ['-TERM', '100', '200', '300'],
      ['-KILL', '100', '200', '300'],
    ]);
  });

  it('reports the run as still alive when its tree survives SIGKILL', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const dir = stepDir();
    const { port } = processTree([300], [300]);
    const runner = createHerdrRunner(port, CELL);
    const handle = await startWithPid(runner, dir);

    // Act
    const stopped = runner.abort(handle);
    await vi.advanceTimersByTimeAsync(20_000);
    const gone = await stopped;
    vi.useRealTimers();

    // Assert
    expect(gone).toBe(false);
  });

  it('confirms a run as gone when its pid was never recorded', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const dir = stepDir();
    const { port } = processTree([], [], false);
    const runner = createHerdrRunner(port, CELL);
    const starting = runner.start(specIn(dir));
    await vi.advanceTimersByTimeAsync(10_000);
    const handle = await starting;

    // Act
    const gone = await runner.abort(handle);
    vi.useRealTimers();

    // Assert
    expect(gone).toBe(true);
  });
});
