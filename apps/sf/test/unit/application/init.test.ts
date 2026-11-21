import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../../../src/application/core/errors';
import type { FsPort } from '../../../src/application/ports/fs.port';
import { initProject } from '../../../src/application/procedures/init/init.procedure';
import {
  type FakePorts,
  createFakePorts,
  runProcedure,
} from '../../support/fake-ports';

const ROOT = '/repo';
const CONFIG = '/repo/.factory/config.json';

const memoryFs = (files: Record<string, string>): FsPort => ({
  readText: async (path) => {
    if (!(path in files)) {
      throw new Error(`ENOENT ${path}`);
    }
    return files[path];
  },
  writeText: async (path, text) => {
    files[path] = text;
  },
  appendText: async (path, text) => {
    files[path] = `${files[path] ?? ''}${text}`;
  },
  exists: async (path) => path in files,
  list: async () => [],
  readStdin: async () => '',
});

const setup = (
  files: Record<string, string>,
  remote: { exitCode: number; stdout: string } = { exitCode: 1, stdout: '' },
): { fake: FakePorts; files: Record<string, string> } => {
  const fake = createFakePorts();
  fake.ports.fs = memoryFs(files);
  fake.ports.process.run = async () => ({ ...remote, stderr: '' });
  return { fake, files };
};

describe('init', () => {
  it('writes every starter file into an empty repo', async () => {
    // Arrange
    const { fake, files } = setup({});

    // Act
    const result = await runProcedure(
      initProject,
      { root: ROOT, dirName: 'repo', projectId: 'widgets', force: false },
      fake,
    );

    // Assert
    expect(result.written).toEqual([
      '.factory/config.json',
      '.factory/lines/standard.yml',
      '.factory/lines/fast.yml',
      '.factory/operators/builder.md',
      '.factory/operators/doctor.md',
      '.factory/templates/pr/body.md',
    ]);
    expect(JSON.parse(files[CONFIG])).toEqual({ project: 'widgets' });
  });

  it('keeps existing files and reports them as skipped', async () => {
    // Arrange
    const { fake, files } = setup({ [CONFIG]: '{"project":"mine"}' });

    // Act
    const result = await runProcedure(
      initProject,
      { root: ROOT, dirName: 'repo', projectId: 'widgets', force: false },
      fake,
    );

    // Assert
    expect(result.skipped).toEqual(['.factory/config.json']);
    expect(files[CONFIG]).toBe('{"project":"mine"}');
  });

  it('overwrites existing files with force', async () => {
    // Arrange
    const { fake, files } = setup({ [CONFIG]: '{"project":"mine"}' });

    // Act
    const result = await runProcedure(
      initProject,
      { root: ROOT, dirName: 'repo', projectId: 'widgets', force: true },
      fake,
    );

    // Assert
    expect(result.skipped).toEqual([]);
    expect(JSON.parse(files[CONFIG])).toEqual({ project: 'widgets' });
  });

  it('adds the local factory paths to gitignore once', async () => {
    // Arrange
    const { fake, files } = setup({ '/repo/.gitignore': 'node_modules/\n' });

    // Act
    const first = await runProcedure(
      initProject,
      { root: ROOT, dirName: 'repo', projectId: 'widgets', force: false },
      fake,
    );
    const second = await runProcedure(
      initProject,
      { root: ROOT, dirName: 'repo', projectId: 'widgets', force: true },
      fake,
    );

    // Assert
    expect(first.gitignoreUpdated).toEqual(['.factory-local/', '.worktrees/']);
    expect(second.gitignoreUpdated).toEqual([]);
    expect(files['/repo/.gitignore']).toBe(
      'node_modules/\n.factory-local/\n.worktrees/\n',
    );
  });

  it('derives the project id from the origin remote when none is given', async () => {
    // Arrange
    const { fake } = setup(
      {},
      { exitCode: 0, stdout: 'git@github.com:acme/widgets.git\n' },
    );

    // Act
    const result = await runProcedure(
      initProject,
      { root: ROOT, dirName: 'repo', projectId: null, force: false },
      fake,
    );

    // Assert
    expect(result.projectId).toBe('widgets');
  });

  it('refuses a project id that is not a slug', async () => {
    // Arrange
    const { fake } = setup({});

    // Act
    const attempt = runProcedure(
      initProject,
      { root: ROOT, dirName: 'repo', projectId: 'Bad Id', force: false },
      fake,
    );

    // Assert
    await expect(attempt).rejects.toThrow(ArgumentError);
  });
});
