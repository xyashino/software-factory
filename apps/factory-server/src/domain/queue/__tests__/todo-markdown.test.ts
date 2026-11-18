import { describe, expect, it } from 'vitest';
import {
  formatTodoMarkdown,
  parseTodoMarkdown,
  type TodoFile,
} from '../todo-markdown';

const TODO_MARKDOWN = `---
status: queued
priority: high
line: feature
plan: payment-v2
depends_on: pay-schema
type: feat
---

# pay-api: Implement payment endpoints

Build the payment endpoints on top of pay-schema.
`;

const parsedTodo = (): TodoFile => {
  const result = parseTodoMarkdown('pay-api.md', TODO_MARKDOWN);
  if (!result.ok) throw new Error(result.error);
  return result.todo;
};

const errorOf = (filename: string, markdown: string): string => {
  const result = parseTodoMarkdown(filename, markdown);
  if (result.ok) throw new Error('expected a parse error');
  return result.error;
};

describe('todo markdown parsing', () => {
  it('reads frontmatter and heading into a work order', () => {
    const todo = parsedTodo();

    expect(todo).toEqual({
      slug: 'pay-api',
      title: 'Implement payment endpoints',
      status: 'queued',
      priority: 'high',
      line: 'feature',
      plan: 'payment-v2',
      dependsOn: 'pay-schema',
      type: 'feat',
      description: 'Build the payment endpoints on top of pay-schema.',
    });
  });

  it('applies queued, medium and feat when the frontmatter omits them', () => {
    const result = parseTodoMarkdown(
      'docs-page.md',
      '---\nline: standard\n---\n\n# docs-page: Write docs\n',
    );

    expect(result).toEqual({
      ok: true,
      todo: {
        slug: 'docs-page',
        title: 'Write docs',
        status: 'queued',
        priority: 'medium',
        line: 'standard',
        plan: null,
        dependsOn: null,
        type: 'feat',
        description: '',
      },
    });
  });

  it('accepts a single parent written as a one element list', () => {
    const result = parseTodoMarkdown(
      'pay-api.md',
      '---\nline: feature\ndepends_on: [pay-schema]\n---\n\n# pay-api: Title\n',
    );

    expect(result).toMatchObject({
      ok: true,
      todo: { dependsOn: 'pay-schema' },
    });
  });

  it('rejects a task with more than one parent', () => {
    const message = errorOf(
      'pay-api.md',
      '---\nline: feature\ndepends_on: [pay-schema, pay-docs]\n---\n\n# pay-api: Title\n',
    );

    expect(message).toBe('depends_on allows at most one parent');
  });

  it('rejects a task without a line', () => {
    const message = errorOf(
      'pay-api.md',
      '---\nstatus: queued\n---\n\n# pay-api: Title\n',
    );

    expect(message).toBe('line is required');
  });

  it('rejects a heading whose slug differs from the file name', () => {
    const message = errorOf(
      'pay-api.md',
      '---\nline: feature\n---\n\n# pay-web: Title\n',
    );

    expect(message).toBe('heading slug pay-web does not match file pay-api');
  });

  it('rejects a status outside the queue vocabulary', () => {
    const message = errorOf(
      'pay-api.md',
      '---\nline: feature\nstatus: running\n---\n\n# pay-api: Title\n',
    );

    expect(message).toBe('status must be one of queued, paused, cancelled');
  });

  it('rejects a file that does not start with frontmatter', () => {
    const message = errorOf('pay-api.md', '# pay-api: Title\n');

    expect(message).toBe('file must start with a --- frontmatter block');
  });

  it('rejects frontmatter that is not a mapping', () => {
    const message = errorOf(
      'pay-api.md',
      '---\n- a\n- b\n---\n\n# pay-api: T\n',
    );

    expect(message).toBe('frontmatter must be a YAML mapping');
  });

  it('rejects frontmatter that is not valid YAML', () => {
    const message = errorOf(
      'pay-api.md',
      '---\nline: [feature\n---\n\n# pay-api: T\n',
    );

    expect(message).toBe('frontmatter is not valid YAML');
  });

  it('rejects a file name that is not a lowercase slug', () => {
    const message = errorOf(
      'Pay API.md',
      '---\nline: feature\n---\n\n# x: T\n',
    );

    expect(message).toBe('filename must be a lowercase slug followed by .md');
  });

  it('rejects a file name without the markdown extension', () => {
    const message = errorOf(
      'pay-api.txt',
      '---\nline: feature\n---\n\n# pay-api: T\n',
    );

    expect(message).toBe('filename must end with .md');
  });

  it('rejects a body without the slug heading', () => {
    const message = errorOf(
      'pay-api.md',
      '---\nline: feature\n---\n\nNo heading\n',
    );

    expect(message).toBe('body must start with "# pay-api: <title>"');
  });

  it('rejects a plan slug that is not lowercase', () => {
    const message = errorOf(
      'pay-api.md',
      '---\nline: feature\nplan: Payment V2\n---\n\n# pay-api: Title\n',
    );

    expect(message).toBe('plan must be a lowercase slug');
  });
});

describe('todo markdown formatting', () => {
  it('writes the same markdown that parses back into the same work order', () => {
    const todo = parsedTodo();

    const markdown = formatTodoMarkdown(todo);

    expect(markdown).toBe(TODO_MARKDOWN);
    expect(parseTodoMarkdown('pay-api.md', markdown)).toEqual({
      ok: true,
      todo,
    });
  });

  it('omits the plan and parent lines when a task has neither', () => {
    const markdown = formatTodoMarkdown({
      slug: 'fix-auth',
      title: 'Fix auth',
      status: 'paused',
      priority: 'low',
      line: 'fast',
      plan: null,
      dependsOn: null,
      type: 'fix',
      description: '',
    });

    expect(markdown).toBe(
      '---\nstatus: paused\npriority: low\nline: fast\ntype: fix\n---\n\n# fix-auth: Fix auth\n',
    );
  });
});
