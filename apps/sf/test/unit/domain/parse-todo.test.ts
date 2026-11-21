import { describe, expect, it } from 'vitest';
import { parseTodo } from '../../../src/domain/todo/parse-todo';

const SAMPLE = `---
status: todo
priority: high
line: feature
plan: web-demo
depends_on: [cli-04]
type: feat
factory: v2
---
# cli-05: queue

Body text.
`;

describe('parse todo', () => {
  it('reads frontmatter fields and keeps unknown keys', () => {
    // Arrange
    // Act
    const todo = parseTodo(SAMPLE);

    // Assert
    expect(todo.frontmatter).toEqual({
      status: 'todo',
      priority: 'high',
      line: 'feature',
      plan: 'web-demo',
      depends_on: ['cli-04'],
      type: 'feat',
      factory: 'v2',
    });
  });

  it('keeps the body exactly as written', () => {
    // Arrange
    // Act
    const todo = parseTodo(SAMPLE);

    // Assert
    expect(todo.body).toBe('# cli-05: queue\n\nBody text.\n');
  });

  it('reads a file without frontmatter as body only', () => {
    // Arrange
    const text = '# no frontmatter\n';

    // Act
    const todo = parseTodo(text);

    // Assert
    expect(todo).toEqual({ frontmatter: {}, body: text });
  });

  it('reports an unclosed frontmatter block', () => {
    // Arrange
    const text = '---\nline: feature\n# body\n';

    // Act
    const attempt = () => parseTodo(text);

    // Assert
    expect(attempt).toThrow('frontmatter is not closed');
  });
});
