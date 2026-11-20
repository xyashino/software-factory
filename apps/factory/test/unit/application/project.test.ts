import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../../../src/application/core/errors';
import { addProject } from '../../../src/application/procedures/projects/add-project.procedure';
import { listProjects } from '../../../src/application/procedures/projects/list-projects.procedure';
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
