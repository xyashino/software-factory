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
import { storePath, supervisorLockPath } from '../../paths';
import { FakeClock } from '../../testing/fake-clock';
import { cleanTodos, performReset, runReset } from '../reset-action';

describe('cleanTodos', () => {
  it('removes delivered tasks, resets parked to todo and preserves draft', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-reset-todos-'));
    writeFileSync(
      join(dir, 'task1.md'),
      '---\nstatus: delivered\npriority: high\n---\n# Task 1\n',
    );
    writeFileSync(
      join(dir, 'task2.md'),
      '---\nstatus: parked\npriority: medium\n---\n# Task 2\n',
    );
    writeFileSync(
      join(dir, 'task3.md'),
      '---\nstatus: draft\npriority: low\n---\n# Task 3\n',
    );
    writeFileSync(
      join(dir, 'task4.md'),
      '---\nstatus: todo\npriority: medium\n---\n# Task 4\n',
    );
    writeFileSync(join(dir, 'ignored.txt'), 'plain text');

    const result = cleanTodos(dir);
    expect(result.deletedCount).toBe(1);
    expect(result.resetCount).toBe(1);

    expect(existsSync(join(dir, 'task1.md'))).toBe(false);
    expect(readFileSync(join(dir, 'task2.md'), 'utf8')).toContain(
      'status: todo',
    );
    expect(readFileSync(join(dir, 'task3.md'), 'utf8')).toContain(
      'status: draft',
    );
    expect(readFileSync(join(dir, 'task4.md'), 'utf8')).toContain(
      'status: todo',
    );
  });
});

describe('performReset', () => {
  it('clears database, logs, worktrees, evidences and deletes delivered todos when hard: true', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-reset-root-'));
    mkdirSync(join(root, '.factory'), { recursive: true });
    mkdirSync(join(root, '.worktrees', 'task-1'), { recursive: true });
    mkdirSync(join(root, '.evidences', 'task-1'), { recursive: true });
    mkdirSync(join(root, 'todos'), { recursive: true });

    writeFileSync(join(root, '.factory', 'supervisor.log'), 'log content\n');
    writeFileSync(
      join(root, 'todos', 'task-1.md'),
      '---\nstatus: delivered\n---\n# Body\n',
    );
    writeFileSync(
      join(root, 'todos', 'task-2.md'),
      '---\nstatus: parked\n---\n# Body\n',
    );

    const store = new SqliteStore({
      path: storePath(root),
      clock: new FakeClock(1_000),
    });
    store.createTask({
      taskId: 'task-1',
      workflow: 'feature',
      todoPath: 'todos/task-1.md',
      branch: 'factory/task-1',
    });
    store.close();

    expect(existsSync(storePath(root))).toBe(true);
    expect(existsSync(join(root, '.factory', 'supervisor.log'))).toBe(true);
    expect(existsSync(join(root, '.worktrees'))).toBe(true);
    expect(existsSync(join(root, '.evidences'))).toBe(true);

    const result = performReset(root, { hard: true, todos: true });

    expect(result.dbCleared).toBe(true);
    expect(result.logCleared).toBe(true);
    expect(result.worktreesRemoved).toBe(true);
    expect(result.evidencesRemoved).toBe(true);
    expect(result.todosDeletedCount).toBe(1);
    expect(result.todosResetCount).toBe(1);

    expect(existsSync(storePath(root))).toBe(false);
    expect(existsSync(join(root, '.factory', 'supervisor.log'))).toBe(false);
    expect(existsSync(join(root, '.worktrees'))).toBe(false);
    expect(existsSync(join(root, '.evidences'))).toBe(false);
    expect(existsSync(join(root, 'todos', 'task-1.md'))).toBe(false);
    expect(readFileSync(join(root, 'todos', 'task-2.md'), 'utf8')).toContain(
      'status: todo',
    );
  });

  it('keeps worktrees, evidences and todos when hard: false', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-reset-soft-'));
    mkdirSync(join(root, '.factory'), { recursive: true });
    mkdirSync(join(root, '.worktrees', 'task-1'), { recursive: true });
    mkdirSync(join(root, '.evidences', 'task-1'), { recursive: true });
    mkdirSync(join(root, 'todos'), { recursive: true });

    writeFileSync(join(root, '.factory', 'supervisor.log'), 'log\n');
    writeFileSync(
      join(root, 'todos', 'task-1.md'),
      '---\nstatus: delivered\n---\n# Body\n',
    );

    const result = performReset(root, { hard: false });

    expect(result.dbCleared).toBe(false);
    expect(result.logCleared).toBe(true);
    expect(result.worktreesRemoved).toBe(false);
    expect(result.evidencesRemoved).toBe(false);
    expect(result.todosDeletedCount).toBe(0);
    expect(result.todosResetCount).toBe(0);

    expect(existsSync(join(root, '.worktrees'))).toBe(true);
    expect(existsSync(join(root, '.evidences'))).toBe(true);
    expect(readFileSync(join(root, 'todos', 'task-1.md'), 'utf8')).toContain(
      'status: delivered',
    );
  });
});

describe('runReset lock handling', () => {
  it('refuses reset when supervisor lock is active without force', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-reset-locked-'));
    mkdirSync(join(root, '.factory'), { recursive: true });
    writeFileSync(
      supervisorLockPath(root),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );

    const prevExitCode = process.exitCode;
    try {
      await runReset({ root, force: false });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = prevExitCode;
    }
  });
});
