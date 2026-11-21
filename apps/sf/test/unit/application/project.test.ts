import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../../../src/application/core/errors';
import { addProject } from '../../../src/application/procedures/projects/add-project.procedure';
import { listProjects } from '../../../src/application/procedures/projects/list-projects.procedure';
import { resolveProjectDefaults } from '../../../src/application/procedures/projects/resolve-project-defaults.procedure';
import { createFakePorts, runProcedure } from '../../support/fake-ports';

const PROJECT = {
  projectId: 'widgets',
  repoUrl: 'https://github.com/acme/widgets.git',
  defaultBaseBranch: 'main',
  maxRunning: 5,
  createdAt: 1,
  updatedAt: 1,
};

const ADD_INPUT = {
  projectId: 'widgets',
  repoUrl: 'https://github.com/acme/widgets.git',
  defaultBaseBranch: 'main',
  maxRunning: 5,
};

describe('project add', () => {
  it('posts the project to the server and returns it', async () => {
    // Arrange
    const fake = createFakePorts({
      reply: () => ({ code: 201, project: PROJECT }),
    });

    // Act
    const result = await runProcedure(addProject, ADD_INPUT, fake);

    // Assert
    expect(result.project.projectId).toBe('widgets');
    expect(fake.calls).toEqual([
      {
        method: 'POST',
        route: '/api/v1/projects',
        body: ADD_INPUT,
        token: 'secret-value',
      },
    ]);
  });

  it('refuses a project id that is not a slug before calling the server', async () => {
    // Arrange
    const fake = createFakePorts({
      reply: () => ({ code: 201, project: PROJECT }),
    });

    // Act
    const attempt = runProcedure(
      addProject,
      { ...ADD_INPUT, projectId: 'Not A Slug' },
      fake,
    );

    // Assert
    await expect(attempt).rejects.toThrow(ArgumentError);
    expect(fake.calls).toEqual([]);
  });
});

const RESOLVE_INPUT = {
  projectId: null,
  repoUrl: null,
  cwd: '/repo',
  configPath: '/repo/.factory/config.json',
  dirName: 'repo',
};

describe('project add defaults', () => {
  it('takes the id from the repo config and the url from origin', async () => {
    // Arrange
    const fake = createFakePorts({ config: '{"project":"widgets-config"}' });
    fake.ports.git.originUrl = async () =>
      'https://github.com/acme/widgets.git';

    // Act
    const result = await runProcedure(
      resolveProjectDefaults,
      RESOLVE_INPUT,
      fake,
    );

    // Assert
    expect(result).toEqual({
      projectId: 'widgets-config',
      repoUrl: 'https://github.com/acme/widgets.git',
      configuredId: 'widgets-config',
    });
  });

  it('derives the id from origin when no repo config exists', async () => {
    // Arrange
    const fake = createFakePorts({ config: null });
    fake.ports.git.originUrl = async () => 'git@github.com:acme/gadgets.git';

    // Act
    const result = await runProcedure(
      resolveProjectDefaults,
      RESOLVE_INPUT,
      fake,
    );

    // Assert
    expect(result.projectId).toBe('gadgets');
    expect(result.configuredId).toBeNull();
  });

  it('derives the id from the directory name when origin is missing', async () => {
    // Arrange
    const fake = createFakePorts({ config: null });
    fake.ports.git.originUrl = async () => null;

    // Act
    const attempt = runProcedure(
      resolveProjectDefaults,
      { ...RESOLVE_INPUT, repoUrl: 'https://example.test/x.git' },
      fake,
    );

    // Assert
    await expect(attempt).resolves.toMatchObject({ projectId: 'repo' });
  });

  it('refuses without a url when there is no origin remote', async () => {
    // Arrange
    const fake = createFakePorts({ config: null });
    fake.ports.git.originUrl = async () => null;

    // Act
    const attempt = runProcedure(resolveProjectDefaults, RESOLVE_INPUT, fake);

    // Assert
    await expect(attempt).rejects.toThrow(ArgumentError);
  });

  it('keeps an explicit id and reports the config id it differs from', async () => {
    // Arrange
    const fake = createFakePorts({ config: '{"project":"widgets-config"}' });
    fake.ports.git.originUrl = async () =>
      'https://github.com/acme/widgets.git';

    // Act
    const result = await runProcedure(
      resolveProjectDefaults,
      { ...RESOLVE_INPUT, projectId: 'other' },
      fake,
    );

    // Assert
    expect(result).toEqual({
      projectId: 'other',
      repoUrl: 'https://github.com/acme/widgets.git',
      configuredId: 'widgets-config',
    });
  });
});

describe('project ls', () => {
  it('returns the projects the server lists', async () => {
    // Arrange
    const fake = createFakePorts({
      reply: () => ({ code: 200, projects: [PROJECT] }),
    });

    // Act
    const result = await runProcedure(listProjects, {}, fake);

    // Assert
    expect(result.projects).toEqual([PROJECT]);
  });
});
