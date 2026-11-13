import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../../ports/store.port';
import { pickTodo } from '../pick-todo';
import { scratchRoot, todoText } from './fixtures';

const workflows = new Set(['feature', 'fast', 'standard']);

const task = (todoPath: string, status: TaskRow['status']): TaskRow => {
  return {
    id: todoPath,
    workflow: 'feature',
    todoPath,
    branch: 'b',
    status,
    createdAt: 0,
    updatedAt: 0,
  };
};

describe('pickTodo', () => {
  it('picks the highest priority ready todo, then by file name', () => {
    const root = scratchRoot({
      'b-low.md': todoText('todo', 'priority: low\n'),
      'a-medium.md': todoText('todo', 'priority: medium\n'),
      'c-high.md': todoText('todo', 'priority: high\n'),
      'd-high.md': todoText('todo', 'priority: high\n'),
    });
    expect(pickTodo(root, [], workflows).pick?.taskId).toBe('c-high');
  });

  it('skips todos that are not status todo, and todos that already have a task', () => {
    const root = scratchRoot({
      'done.md': todoText('done', 'priority: high\n'),
      'running.md': todoText('todo', 'priority: high\n'),
      'next.md': todoText('todo'),
    });
    const scan = pickTodo(
      root,
      [task('todos/running.md', 'running')],
      workflows,
    );
    expect(scan.pick?.todoPath).toBe('todos/next.md');
  });

  it('waits for dependencies that are not delivered', () => {
    const root = scratchRoot({
      'first.md': todoText('todo'),
      'second.md': todoText('todo', 'depends_on: [first]\n'),
    });
    const scan = pickTodo(root, [], workflows);
    expect(scan.pick?.todoPath).toBe('todos/first.md');
    expect(
      pickTodo(root, [task('todos/first.md', 'running')], workflows).pick,
    ).toBeUndefined();
    expect(
      pickTodo(root, [task('todos/first.md', 'delivered')], workflows).pick
        ?.todoPath,
    ).toBe('todos/second.md');
  });

  it('counts a delivered dependency as done after its todo file is removed', () => {
    const root = scratchRoot({
      'second.md': todoText('todo', 'depends_on: [first]\n'),
    });
    expect(
      pickTodo(root, [task('todos/first.md', 'delivered')], workflows).pick
        ?.todoPath,
    ).toBe('todos/second.md');
  });

  it('treats a dependency marked done in its file as satisfied', () => {
    const root = scratchRoot({
      'first.md': todoText('done'),
      'second.md': todoText('todo', 'depends_on: [first]\n'),
    });
    expect(pickTodo(root, [], workflows).pick?.todoPath).toBe(
      'todos/second.md',
    );
  });

  it('treats a dependency whose todo file is absent as satisfied', () => {
    const root = scratchRoot({
      'second.md': todoText('todo', 'depends_on: [prerequisite]\n'),
    });
    const scan = pickTodo(root, [], workflows);
    expect(scan.pick?.todoPath).toBe('todos/second.md');
    expect(scan.skipped).toEqual([]);
  });

  it('blocks on an existing dependency file with status todo', () => {
    const root = scratchRoot({
      'prerequisite.md': todoText('todo'),
      'second.md': todoText('todo', 'depends_on: [prerequisite]\n'),
    });
    const scan = pickTodo(root, [], workflows);
    expect(scan.pick?.todoPath).toBe('todos/prerequisite.md');
    expect(scan.skipped).toEqual(['todos/second.md: waiting for prerequisite']);
  });

  it('blocks on an existing dependency file that cannot be parsed', () => {
    const root = scratchRoot({
      'prerequisite.md': 'no frontmatter here\n',
      'second.md': todoText('todo', 'depends_on: [prerequisite]\n'),
    });
    const scan = pickTodo(root, [], workflows);
    expect(scan.pick).toBeUndefined();
    expect(scan.skipped).toEqual(['todos/second.md: waiting for prerequisite']);
  });

  it('defaults the workflow to feature and skips unknown workflows with a reason', () => {
    const root = scratchRoot({
      'plain.md': todoText('todo'),
      'odd.md': todoText('todo', 'workflow: nope\n'),
    });
    const scan = pickTodo(root, [], workflows);
    expect(scan.pick).toMatchObject({ taskId: 'plain', workflow: 'feature' });
    const after = pickTodo(
      root,
      [task('todos/plain.md', 'delivered')],
      workflows,
    );
    expect(after.pick).toBeUndefined();
    expect(after.skipped).toEqual(['todos/odd.md: unknown workflow "nope"']);
  });

  it('picks todos that select the standard or fast workflow', () => {
    const root = scratchRoot({
      'a-std.md': todoText('todo', 'workflow: standard\n'),
      'b-fast.md': todoText('todo', 'workflow: fast\n'),
    });
    expect(pickTodo(root, [], workflows).pick).toMatchObject({
      taskId: 'a-std',
      workflow: 'standard',
    });
    const after = pickTodo(
      root,
      [task('todos/a-std.md', 'delivered')],
      workflows,
    );
    expect(after.pick).toMatchObject({ taskId: 'b-fast', workflow: 'fast' });
    expect(after.skipped).toEqual([]);
  });

  it('returns nothing when no todo is ready', () => {
    const root = scratchRoot({ 'x.md': todoText('done') });
    expect(pickTodo(root, [], workflows)).toEqual({
      pick: undefined,
      skipped: [],
    });
  });
});
