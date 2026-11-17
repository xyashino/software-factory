import { describe, expect, it } from 'vitest';
import { projectIdSchema } from '@repo/factory-core/ids';
import { parseTodo } from '@repo/factory-definitions/todo';
import { renderTodoFile } from '../commands/todo-render';

describe('todos export file', () => {
  it('reads back through the todo parser as the same todo', () => {
    const body = '\n# a-two: Second step\n\nDo the second step.\n';
    const text = renderTodoFile({
      todoId: 'a-two',
      status: 'todo',
      priority: 'high',
      type: 'fix',
      line: 'feature',
      dependsOn: ['a-one'],
      plan: 'pl',
      body,
    });

    const parsed = parseTodo(
      projectIdSchema.parse('demo'),
      'todos/a-two.md',
      text,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.diagnostics).toEqual([]);
    expect(parsed.value.todo).toMatchObject({
      orderId: 'demo:a-two',
      todoId: 'a-two',
      status: 'todo',
      priority: 'high',
      type: 'fix',
      line: 'feature',
      plan: 'pl',
      factory: 'v2',
      dependsOn: ['demo:a-one'],
      title: 'Second step',
      body,
    });
  });
});
