import { describe, expect, it } from 'vitest';
import {
  REPO_CONFIG_PATH,
  WORKSPACES_DIR,
  LINES_DIR,
} from '../../../../../src/config';
import {
  ArgumentError,
  Refused,
} from '../../../../../src/application/core/errors';
import type { Ports } from '../../../../../src/application/core/procedure';
import { ensureWorkspace } from '../../../../../src/application/procedures/cell/workspace';
import type { ProjectSummary } from '../../../../../src/application/procedures/cell/resolve-project-target';
import { joinPath } from '../../../../../src/domain/common/path';
import { createFakePorts } from '../../../../support/fake-ports';

const PROJECT: ProjectSummary = {
  projectId: 'alpha',
  repoUrl: 'https://example.test/alpha.git',
  defaultBaseBranch: 'main',
};

const DIR = joinPath(WORKSPACES_DIR, PROJECT.projectId);
const GIT_DIR = joinPath(DIR, '.git');
const CONFIG = joinPath(DIR, REPO_CONFIG_PATH);

interface Checkout {
  present: string[];
  origin: string | null;
  clean: boolean;
  lineFiles: string[];
}

interface FakeWorkspace {
  ports: Ports;
  clones: { url: string; dest: string }[];
}

const workspaceWith = (checkout: Checkout): FakeWorkspace => {
  const base = createFakePorts().ports;
  const present = new Set(checkout.present);
  const clones: FakeWorkspace['clones'] = [];
  const ports: Ports = {
    ...base,
    fs: {
      ...base.fs,
      exists: async (path) => present.has(path),
      list: async (dir) =>
        dir === joinPath(DIR, LINES_DIR) ? checkout.lineFiles : [],
      readText: async () => JSON.stringify({ project: PROJECT.projectId }),
    },
    git: {
      ...base.git,
      clone: async (url, dest) => {
        clones.push({ url, dest });
        present.add(joinPath(dest, '.git'));
        present.add(joinPath(dest, REPO_CONFIG_PATH));
      },
      originUrl: async () => checkout.origin,
      isClean: async () => checkout.clean,
    },
  };
  return { ports, clones };
};

const FRESH: Checkout = {
  present: [],
  origin: null,
  clean: true,
  lineFiles: ['feature.yml'],
};

describe('project workspace', () => {
  it('clones a project without a checkout into its workspace', async () => {
    // Arrange
    const { ports, clones } = workspaceWith(FRESH);

    // Act
    const dir = await ensureWorkspace(ports, PROJECT);

    // Assert
    expect(dir).toBe(DIR);
    expect(clones).toEqual([{ url: PROJECT.repoUrl, dest: DIR }]);
  });

  it('reuses a clean clone of the same repository without cloning again', async () => {
    // Arrange
    const { ports, clones } = workspaceWith({
      ...FRESH,
      present: [GIT_DIR, CONFIG],
      origin: PROJECT.repoUrl,
    });

    // Act
    const dir = await ensureWorkspace(ports, PROJECT);

    // Assert
    expect(dir).toBe(DIR);
    expect(clones).toEqual([]);
  });

  it('refuses a workspace cloned from another repository', async () => {
    // Arrange
    const { ports } = workspaceWith({
      ...FRESH,
      present: [GIT_DIR],
      origin: 'https://example.test/other.git',
    });

    // Act
    const ensure = ensureWorkspace(ports, PROJECT);

    // Assert
    await expect(ensure).rejects.toBeInstanceOf(Refused);
  });

  it('refuses a workspace with uncommitted changes', async () => {
    // Arrange
    const { ports } = workspaceWith({
      ...FRESH,
      present: [GIT_DIR],
      origin: PROJECT.repoUrl,
      clean: false,
    });

    // Act
    const ensure = ensureWorkspace(ports, PROJECT);

    // Assert
    await expect(ensure).rejects.toBeInstanceOf(Refused);
  });

  it('refuses a workspace path that exists but is not a clone', async () => {
    // Arrange
    const { ports, clones } = workspaceWith({ ...FRESH, present: [DIR] });

    // Act
    const ensure = ensureWorkspace(ports, PROJECT);

    // Assert
    await expect(ensure).rejects.toBeInstanceOf(Refused);
    expect(clones).toEqual([]);
  });

  it('refuses a cloned project that has no line files', async () => {
    // Arrange
    const { ports } = workspaceWith({ ...FRESH, lineFiles: [] });

    // Act
    const ensure = ensureWorkspace(ports, PROJECT);

    // Assert
    await expect(ensure).rejects.toBeInstanceOf(ArgumentError);
  });
});
