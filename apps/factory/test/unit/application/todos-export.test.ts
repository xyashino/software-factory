import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../../../src/application/core/errors';
import { exportTodos } from '../../../src/application/procedures/todos/export.procedure';
import { createFakePorts, runProcedure } from '../../support/fake-ports';

const CONFIG = '/repo/.factory/config.json';
const DIR = '/repo/todos';

const EXPORTED = {
  projectId: 'software-factory',
  exportedAt: 1,
  files: [
    {
      filename: 'cli-05.md',
      markdown: '---\nline: feature\n---\n# cli-05: q\n',
    },
  ],
};

const input = (force: boolean) => ({ configPath: CONFIG, dir: DIR, force });

describe('todos export', () => {
  it('writes each exported work order into the todos directory', async () => {
    // Arrange
    const fake = createFakePorts({ reply: () => EXPORTED });

    // Act
    const result = await runProcedure(exportTodos, input(false), fake);

    // Assert
    expect(fake.calls[0]).toMatchObject({
      method: 'GET',
      route: '/api/v1/queue/export',
      query: { projectId: 'software-factory' },
    });
    expect(fake.writes).toEqual([
      { dir: DIR, filename: 'cli-05.md', force: false },
    ]);
    expect(result.written).toEqual(['cli-05.md']);
  });

  it('lists files it refused to overwrite without --force', async () => {
    // Arrange
    const fake = createFakePorts({
      reply: () => EXPORTED,
      writeOutcome: 'refused',
    });

    // Act
    const result = await runProcedure(exportTodos, input(false), fake);

    // Assert
    expect(result.refused).toEqual(['cli-05.md']);
    expect(result.written).toEqual([]);
  });

  it('passes force through so existing files are overwritten', async () => {
    // Arrange
    const fake = createFakePorts({ reply: () => EXPORTED });

    // Act
    await runProcedure(exportTodos, input(true), fake);

    // Assert
    expect(fake.writes[0]?.force).toBe(true);
  });

  it('refuses an export whose project differs from config', async () => {
    // Arrange
    const fake = createFakePorts({
      reply: () => ({ ...EXPORTED, projectId: 'other-project' }),
    });

    // Act
    const attempt = runProcedure(exportTodos, input(false), fake);

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(ArgumentError);
    expect(fake.writes).toEqual([]);
  });
});
