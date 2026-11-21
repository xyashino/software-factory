import { describe, expect, it } from 'vitest';
import { ArgumentError, Refused } from '../../../src/application/core/errors';
import { importTodos } from '../../../src/application/procedures/todos/import.procedure';
import { createFakePorts, runProcedure } from '../../support/fake-ports';

const CONFIG = '/repo/.factory/config.json';
const DIR = '/repo/todos';

const READY = `---
status: todo
priority: high
line: feature
plan: web-demo
---
# cli-05: queue

Body.
`;

const NO_LINE = `---
status: todo
---
# cli-06: later

Body.
`;

const input = (dryRun: boolean) => ({ configPath: CONFIG, dir: DIR, dryRun });

describe('todos import', () => {
  it('lists the files it would send and sends nothing on dry run', async () => {
    // Arrange
    const fake = createFakePorts({
      todos: { 'cli-05.md': READY, 'cli-06.md': NO_LINE },
    });

    // Act
    const result = await runProcedure(importTodos, input(true), fake);

    // Assert
    expect(result.sent).toEqual(['cli-05.md']);
    expect(result.skipped).toEqual([
      { filename: 'cli-06.md', reason: 'no line' },
    ]);
    expect(fake.calls).toEqual([]);
  });

  it('sends one apply request with the project from config', async () => {
    // Arrange
    const fake = createFakePorts({
      todos: { 'cli-05.md': READY, 'cli-06.md': NO_LINE },
      reply: () => ({ created: 1, updated: 0, skipped: 0, errors: [] }),
    });

    // Act
    const result = await runProcedure(importTodos, input(false), fake);

    // Assert
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      method: 'POST',
      route: '/api/v1/queue/import',
      token: 'secret-value',
      body: {
        projectId: 'software-factory',
        mode: 'apply',
        files: [{ filename: 'cli-05.md', markdown: READY }],
      },
    });
    expect(result.created).toBe(1);
  });

  it('reports each rejected file and keeps the rest of the batch', async () => {
    // Arrange
    const fake = createFakePorts({
      todos: { 'cli-05.md': READY },
      reply: () => {
        throw new Refused('422: unprocessable-entity', {
          code: 422,
          errors: [{ filename: 'cli-05.md', message: 'slug conflict' }],
        });
      },
    });

    // Act
    const result = await runProcedure(importTodos, input(false), fake);

    // Assert
    expect(result.errors).toEqual([
      { filename: 'cli-05.md', message: 'slug conflict' },
    ]);
  });

  it('refuses to run without a repo config', async () => {
    // Arrange
    const fake = createFakePorts({ config: null, todos: {} });

    // Act
    const attempt = runProcedure(importTodos, input(true), fake);

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(ArgumentError);
  });
});
