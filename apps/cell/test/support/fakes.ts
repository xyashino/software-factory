import { BadGateway } from '../../src/application/core/error-handling';
import type {
  EnrollRequest,
  EnrolledCell,
  FactoryClientPort,
  ProjectSummary,
} from '../../src/application/ports/factory-client.port';
import type {
  RepoInspectorPort,
  RepoProfile,
} from '../../src/application/ports/repo-inspector.port';
import type {
  SlotLaunch,
  SupervisorPort,
} from '../../src/application/ports/supervisor.port';
import type { WorkspacePort } from '../../src/application/ports/workspace.port';
import { asSlotId, type SlotId } from '../../src/domain/common/brand';

export type FakeSupervisor = SupervisorPort & {
  starts: SlotId[];
  stops: { slotId: SlotId; force: boolean }[];
  failStarts: boolean;
};

export type FakeFactoryClient = FactoryClientPort & {
  enrolls: { factoryUrl: string; joinToken: string; request: EnrollRequest }[];
  failEnroll: boolean;
  addProject(project: ProjectSummary): void;
};

export type FakeRepoInspector = RepoInspectorPort & {
  addRepo(repoRoot: string, profile?: RepoProfile): void;
};

export type FakeWorkspace = WorkspacePort & {
  ensures: { projectId: string; repoUrl: string }[];
};

export const WORKSPACE_ROOT = '/work/workspaces';

export const SESSION_SECRET_PREFIX = 'SESSION-SECRET-';

export const createFakeSupervisor = (): FakeSupervisor => {
  const live = new Set<SlotId>();
  const fake: FakeSupervisor = {
    starts: [],
    stops: [],
    failStarts: false,
    start: async (launch: SlotLaunch) => {
      fake.starts.push(launch.slotId);
      if (fake.failStarts) throw new Error('spawn failed');
      live.add(launch.slotId);
      return { pid: 4242 };
    },
    stop: async (slotId, { force }) => {
      fake.stops.push({ slotId, force });
      live.delete(slotId);
    },
    status: async (slotId) =>
      live.has(asSlotId(slotId)) ? 'running' : 'stopped',
  };
  return fake;
};

export const createFakeFactoryClient = (): FakeFactoryClient => {
  let enrolled = 0;
  const projects: ProjectSummary[] = [];
  const fake: FakeFactoryClient = {
    enrolls: [],
    failEnroll: false,
    health: async () => true,
    mintJoinToken: async () => 'minted-join-token',
    listProjects: async () => [...projects],
    addProject: (project) => {
      projects.push(project);
    },
    enroll: async (
      factoryUrl: string,
      joinToken: string,
      request: EnrollRequest,
    ): Promise<EnrolledCell> => {
      fake.enrolls.push({ factoryUrl, joinToken, request });
      if (fake.failEnroll) throw new BadGateway('factory unreachable');
      enrolled += 1;
      return {
        cellId: `cell-${enrolled}`,
        sessionToken: `${SESSION_SECRET_PREFIX}${enrolled}`,
      };
    },
  };
  return fake;
};

export const createFakeWorkspace = (): FakeWorkspace => {
  const fake: FakeWorkspace = {
    ensures: [],
    ensure: async (projectId, repoUrl) => {
      fake.ensures.push({ projectId, repoUrl });
      return `${WORKSPACE_ROOT}/${projectId}`;
    },
  };
  return fake;
};

export const createFakeRepoInspector = (): FakeRepoInspector => {
  const repos = new Map<string, RepoProfile>();
  return {
    addRepo: (repoRoot, profile = { projectId: 'app', lines: ['main'] }) => {
      repos.set(repoRoot, profile);
    },
    inspect: (repoRoot) => repos.get(repoRoot) ?? null,
  };
};
