import { describe, expect, it } from 'vitest';
import {
  ArgumentError,
  Refused,
} from '../../../../../src/application/core/errors';
import {
  pickProject,
  type ProjectSummary,
} from '../../../../../src/application/procedures/cell/resolve-project-target';

const ALPHA: ProjectSummary = {
  projectId: 'alpha',
  repoUrl: 'https://example.test/alpha.git',
  defaultBaseBranch: 'main',
};

const BETA: ProjectSummary = {
  projectId: 'beta',
  repoUrl: 'https://example.test/beta.git',
  defaultBaseBranch: 'develop',
};

const PROJECTS = [ALPHA, BETA];

describe('project target selection', () => {
  it('uses the project of the repo config without asking', async () => {
    // Act
    const picked = await pickProject({
      repoProject: 'alpha',
      projects: PROJECTS,
      requested: undefined,
    });

    // Assert
    expect(picked).toEqual(ALPHA);
  });

  it('accepts a --project that matches the repo config', async () => {
    // Act
    const picked = await pickProject({
      repoProject: 'beta',
      projects: PROJECTS,
      requested: 'beta',
    });

    // Assert
    expect(picked).toEqual(BETA);
  });

  it('refuses a repo config whose project is not registered on the Factory', async () => {
    // Arrange
    const pick = pickProject({
      repoProject: 'ghost',
      projects: PROJECTS,
      requested: undefined,
    });

    // Act & Assert
    await expect(pick).rejects.toBeInstanceOf(Refused);
    await expect(pick).rejects.toThrow('sf project add ghost');
  });

  it('refuses a --project that disagrees with the repo config', async () => {
    // Arrange
    const pick = pickProject({
      repoProject: 'alpha',
      projects: PROJECTS,
      requested: 'beta',
    });

    // Act & Assert
    await expect(pick).rejects.toBeInstanceOf(ArgumentError);
  });
});
