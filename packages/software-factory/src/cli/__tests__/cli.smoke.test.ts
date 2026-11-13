import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteStore } from '../../adapters/store/sqlite-store';
import { FakeClock } from '../../testing/fake-clock';
import { storePath, supervisorLockPath, PACKAGE_ROOT } from '../../paths';

/** Both shipped command names; they must behave identically. */
const BINARIES = ['sf', 'software-factory'].map((name) =>
  join(PACKAGE_ROOT, 'bin', name),
);

/** Runs a real CLI binary against a store under a temporary root. */
const cli = (
  binary: string,
  root: string,
  ...args: string[]
): { code: number; out: string } => {
  try {
    // Never inherit a pane identity: the tests may run inside a factory agent.
    const env: Record<string, string | undefined> = {
      ...process.env,
      FACTORY_ROOT: root,
      NO_COLOR: '1',
    };
    delete env.FACTORY_TASK;
    delete env.FACTORY_ATTEMPT;
    const out = execFileSync(binary, args, {
      env,
      encoding: 'utf8',
    });
    return { code: 0, out };
  } catch (error) {
    const failed = error as { status: number; stdout: string; stderr: string };
    return { code: failed.status, out: `${failed.stdout}${failed.stderr}` };
  }
};

describe.each(BINARIES)('CLI subprocess via %s', (binary) => {
  it('prints the board and the log of a task from the store', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-cli-'));
    const store = new SqliteStore({
      path: storePath(root),
      clock: new FakeClock(5_000),
    });
    store.createTask({
      taskId: 'hello',
      workflow: 'feature',
      todoPath: 'todos/hello.md',
      branch: 'factory/hello',
    });
    store.append('hello', {
      type: 'task_created',
      workflow: 'feature',
      todoPath: 'todos/hello.md',
      branch: 'factory/hello',
    });
    store.append('hello', { type: 'setup_started' });
    store.append('hello', {
      type: 'setup_finished',
      ok: true,
      log: 'setup.log',
    });
    store.append('hello', { type: 'delivery_started', to: 'new-pr' });
    store.append('hello', {
      type: 'delivered',
      prUrl: 'https://example.test/pr/1',
    });
    store.setTaskStatus('hello', 'delivered');
    store.close();

    const board = cli(binary, root, 'status');
    expect(board.code).toBe(0);
    expect(board.out).toContain('hello');
    expect(board.out).toContain('delivered');

    const log = cli(binary, root, 'log', 'hello');
    expect(log.code).toBe(0);
    expect(log.out).toContain('task_created');
    expect(log.out).toContain('https://example.test/pr/1');

    const json = cli(binary, root, 'log', 'hello', '--json');
    expect(JSON.parse(json.out)).toEqual([
      expect.objectContaining({
        taskId: 'hello',
        seq: 1,
        event: expect.objectContaining({ type: 'task_created' }),
      }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        event: { type: 'delivered', prUrl: 'https://example.test/pr/1' },
      }),
    ]);
  });

  it('refuses done outside an agent pane with a clear message', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-cli-'));
    const result = cli(binary, root, 'done');
    expect(result.code).toBe(1);
    expect(result.out).toContain(
      'not inside an active software-factory agent pane',
    );
  });

  it('reports an unknown task on log', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-cli-'));
    const result = cli(binary, root, 'log', 'nope');
    expect(result.code).toBe(1);
    expect(result.out).toContain('no task "nope"');
  });

  it('answers an open question from a plain shell and refuses a second answer', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-cli-'));
    const store = new SqliteStore({
      path: storePath(root),
      clock: new FakeClock(5_000),
    });
    store.createTask({
      taskId: 'hello',
      workflow: 'feature',
      todoPath: 'todos/hello.md',
      branch: 'factory/hello',
    });
    store.append('hello', {
      type: 'task_created',
      workflow: 'feature',
      todoPath: 'todos/hello.md',
      branch: 'factory/hello',
    });
    store.append('hello', { type: 'setup_finished', ok: true, log: 'l' });
    store.append('hello', {
      type: 'attempt_started',
      attemptId: 'att-1',
      stepId: 'plan',
      n: 1,
      snapshotRef: 'refs/software-factory/hello/plan/att-1',
      artifacts: {},
    });
    store.append('hello', {
      type: 'question_asked',
      attemptId: 'att-1',
      questionId: 'q1',
      to: 'human',
      text: 'which db?',
    });
    store.close();

    const board = cli(binary, root, 'status');
    expect(board.out).toContain('sf answer hello');

    const answered = cli(binary, root, 'answer', 'hello', 'postgres');
    expect(answered.code).toBe(0);
    expect(answered.out).toContain('answered question q1');

    const again = cli(binary, root, 'answer', 'hello', 'postgres');
    expect(again.code).toBe(1);
    expect(again.out).toContain('no open question');
  }, 20_000);

  it.each(['ask', 'tell'])('refuses %s outside an agent pane', (command) => {
    const root = mkdtempSync(join(tmpdir(), 'sf-cli-'));
    const result = cli(binary, root, command, 'human', 'hello');
    expect(result.code).toBe(1);
    expect(result.out).toContain('not inside an active software-factory');
  });

  it('refuses a second sf run while a live holder owns the lock and leaves the store alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-cli-'));
    mkdirSync(join(root, '.factory'), { recursive: true });
    writeFileSync(
      supervisorLockPath(root),
      JSON.stringify({
        pid: process.pid,
        startedAt: '2026-11-12T10:00:00.000Z',
      }),
    );

    const result = cli(binary, root, 'run');

    expect(result.code).toBe(1);
    expect(result.out).toContain(
      `sf run already running: pid ${process.pid} since 2026-11-12T10:00:00.000Z`,
    );
    expect(existsSync(storePath(root))).toBe(false);
  }, 20_000);

  it('refuses unblock for an unknown task', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-cli-'));
    const result = cli(binary, root, 'unblock', 'nope');
    expect(result.code).toBe(1);
    expect(result.out).toContain('task nope is not known');
  });

  it('resets software factory state through reset command', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-cli-'));
    mkdirSync(join(root, '.factory'), { recursive: true });
    mkdirSync(join(root, 'todos'), { recursive: true });
    writeFileSync(join(root, '.factory', 'supervisor.log'), 'log\n');
    writeFileSync(
      join(root, 'todos', 'item.md'),
      '---\nstatus: delivered\n---\n# Item\n',
    );
    writeFileSync(
      join(root, 'todos', 'parked.md'),
      '---\nstatus: parked\n---\n# Parked\n',
    );
    const store = new SqliteStore({
      path: storePath(root),
      clock: new FakeClock(5_000),
    });
    store.createTask({
      taskId: 'item',
      workflow: 'feature',
      todoPath: 'todos/item.md',
      branch: 'factory/item',
    });
    store.close();

    const result = cli(binary, root, 'reset');
    expect(result.code).toBe(0);
    expect(result.out).toContain('Software factory reset complete');
    expect(existsSync(storePath(root))).toBe(false);
    expect(existsSync(join(root, '.factory', 'supervisor.log'))).toBe(false);
    expect(existsSync(join(root, 'todos', 'item.md'))).toBe(false);
    expect(readFileSync(join(root, 'todos', 'parked.md'), 'utf8')).toContain(
      'status: todo',
    );
  });
});
