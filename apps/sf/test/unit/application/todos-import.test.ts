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

const CANCELLED = `---
status: cancelled
line: feature
---
# cli-07: old

Body.
`;

const PAUSED_READY = `---
status: paused
priority: high
line: feature
plan: web-demo
---
# cli-05: queue

Body.
`;

const input = (dryRun: boolean, paused = false) => ({
  configPath: CONFIG,
  dir: DIR,
  dryRun,
  paused,
});

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

  it('sends work orders paused and keeps cancelled ones cancelled', async () => {
    // Arrange
    const fake = createFakePorts({
      todos: { 'cli-05.md': READY, 'cli-07.md': CANCELLED },
      reply: () => ({ created: 2, updated: 0, skipped: 0, errors: [] }),
    });

    // Act
    const result = await runProcedure(importTodos, input(false, true), fake);

    // Assert
    expect(fake.calls[0]).toMatchObject({
      body: {
        files: [
          { filename: 'cli-05.md', markdown: PAUSED_READY },
          { filename: 'cli-07.md', markdown: CANCELLED },
        ],
      },
    });
    expect(result.paused).toBe(1);
  });

  it('counts the work orders it would pause on dry run without sending', async () => {
    // Arrange
    const fake = createFakePorts({
      todos: { 'cli-05.md': READY, 'cli-07.md': CANCELLED },
    });

    // Act
    const result = await runProcedure(importTodos, input(true, true), fake);

    // Assert
    expect(result.paused).toBe(1);
    expect(fake.calls).toEqual([]);
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
