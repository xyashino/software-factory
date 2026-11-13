import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../../ports/store.port';
import { todoBodyOf } from '../task-context';
import { harness, scratchRoot, todoText } from './fixtures';

const task: TaskRow = {
  id: 'hello',
  workflow: 'feature',
  todoPath: 'todos/hello.md',
  branch: 'factory/hello',
  status: 'delivered',
  createdAt: 0,
  updatedAt: 0,
};

describe('todoBodyOf', () => {
  it('returns an empty body when the todo file is gone', () => {
    expect(todoBodyOf(harness(scratchRoot({})).ports, task)).toBe('');
  });

  it('reads the body without frontmatter when the file exists', () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    expect(todoBodyOf(harness(root).ports, task)).toBe(
      '# Todo: hello\n\nAdd a hello script.',
    );
  });
});
