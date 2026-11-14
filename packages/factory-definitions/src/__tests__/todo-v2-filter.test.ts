import { describe, expect, it } from 'vitest';
import { projectIdSchema } from '@repo/factory-core/ids';
import { scanTodos } from '../todo-scan';
import type { TodoSource } from '../todo';

const PROJECT = projectIdSchema.parse('software-factory');
const LINES = new Set(['feature']);

const todo = (name: string, extra = ''): TodoSource => ({
  file: `todos/${name}.md`,
  text: `---\nstatus: todo\n${extra}---\n\n# ${name}\n`,
});

describe('v2 cut-over filter', () => {
  it('takes only factory v2 todos while the flag is on', () => {
    const scan = scanTodos(
      PROJECT,
      [todo('moved', 'factory: v2\n'), todo('still-v1')],
      LINES,
      new Set(),
      { requireV2: true },
    );

    expect(scan.todos.map((item) => item.todoId)).toEqual(['moved']);
    expect(scan.diagnostics).toEqual([]);
  });

  it('takes every todo while the flag is off', () => {
    const scan = scanTodos(
      PROJECT,
      [todo('a'), todo('b', 'factory: v2\n')],
      LINES,
    );

    expect(scan.todos.map((item) => item.todoId)).toEqual(['a', 'b']);
  });

  it('leaves a v1 todo out silently even when its line is unknown', () => {
    const scan = scanTodos(
      PROJECT,
      [
        {
          file: 'todos/odd.md',
          text: '---\nstatus: todo\nline: nope\n---\n',
        },
      ],
      LINES,
      new Set(),
      { requireV2: true },
    );

    expect(scan.todos).toEqual([]);
    expect(scan.diagnostics.map((item) => item.kind)).toEqual([]);
  });
});
