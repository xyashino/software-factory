import { describe, expect, it } from 'vitest';
import { parseTodo } from '../../../src/domain/todo/parse-todo';
import { renderTodo } from '../../../src/domain/todo/render-todo';

const SHUFFLED = `---
factory: v2
type: feat
depends_on: [cli-04]
plan: web-demo
line: feature
priority: high
status: todo
---
# cli-05: queue

Body text.
`;

describe('render todo', () => {
  it('writes known keys in fixed order before unknown keys', () => {
    // Arrange
    const todo = parseTodo(SHUFFLED);

    // Act
    const text = renderTodo(todo);

    // Assert
    expect(text.split('\n').slice(1, 8)).toEqual([
      'status: todo',
      'priority: high',
      'line: feature',
      'plan: web-demo',
      'depends_on:',
      '  - cli-04',
      'type: feat',
    ]);
  });

  it('round trips parse, render and parse to the same object', () => {
    // Arrange
    const first = parseTodo(SHUFFLED);

    // Act
    const second = parseTodo(renderTodo(first));

    // Assert
    expect(second).toEqual(first);
  });

  it('keeps the body byte for byte', () => {
    // Arrange
    const todo = parseTodo(SHUFFLED);

    // Act
    const second = parseTodo(renderTodo(todo));

    // Assert
    expect(second.body).toBe(todo.body);
  });

  it('writes body only when there is no frontmatter', () => {
    // Arrange
    const todo = parseTodo('# plain\n');

    // Act
    const text = renderTodo(todo);

    // Assert
    expect(text).toBe('# plain\n');
  });
});
