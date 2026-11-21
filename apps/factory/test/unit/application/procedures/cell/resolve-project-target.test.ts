import { describe, expect, it, vi } from 'vitest';
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
    // Arrange
    const choose = vi.fn(async () => BETA);

    // Act
    const picked = await pickProject({
      repoProject: 'alpha',
      projects: PROJECTS,
      requested: undefined,
      choose,
    });

    // Assert
    expect(picked).toEqual(ALPHA);
    expect(choose).not.toHaveBeenCalled();
  });

  it('refuses a repo config whose project is not registered on the Factory', async () => {
    // Arrange
    const pick = pickProject({
      repoProject: 'ghost',
      projects: PROJECTS,
      requested: undefined,
      choose: undefined,
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
      choose: undefined,
    });

    // Act & Assert
    await expect(pick).rejects.toBeInstanceOf(ArgumentError);
  });

  it('refuses outside a repo when no project is registered', async () => {
    // Arrange
    const pick = pickProject({
      repoProject: null,
      projects: [],
      requested: undefined,
      choose: undefined,
    });

    // Act & Assert
    await expect(pick).rejects.toBeInstanceOf(Refused);
    await expect(pick).rejects.toThrow('sf project add');
  });

  it('picks the requested registered project without asking', async () => {
    // Arrange
    const choose = vi.fn(async () => ALPHA);

    // Act
    const picked = await pickProject({
      repoProject: null,
      projects: PROJECTS,
      requested: 'beta',
      choose,
    });

    // Assert
    expect(picked).toEqual(BETA);
    expect(choose).not.toHaveBeenCalled();
  });

  it('refuses a requested project that is not registered', async () => {
    // Arrange
    const pick = pickProject({
      repoProject: null,
      projects: PROJECTS,
      requested: 'ghost',
      choose: undefined,
    });

    // Act & Assert
    await expect(pick).rejects.toBeInstanceOf(Refused);
    await expect(pick).rejects.toThrow('sf project add ghost');
  });

  it('asks for the arguments when outside a repo without a terminal', async () => {
    // Arrange
    const pick = pickProject({
      repoProject: null,
      projects: PROJECTS,
      requested: undefined,
      choose: undefined,
    });

    // Act & Assert
    await expect(pick).rejects.toBeInstanceOf(ArgumentError);
    await expect(pick).rejects.toThrow('alpha, beta');
  });

  it('asks the terminal chooser once and returns its pick', async () => {
    // Arrange
    const choose = vi.fn(async () => BETA);

    // Act
    const picked = await pickProject({
      repoProject: null,
      projects: PROJECTS,
      requested: undefined,
      choose,
    });

    // Assert
    expect(picked).toEqual(BETA);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith(PROJECTS);
  });
});
