import type { ProjectId } from '@repo/factory-core/ids';
import type {
  ProjectPatch,
  ProjectRecord,
  ProjectStoreResult,
} from '@repo/factory-core/ports/projects';
import { notFound, RuntimeError } from './errors';
import type { RuntimePorts } from './ports';

/**
 * Project registry operations (PROTOCOL §3.1). The store answers with a reason when it refuses; the
 * runtime turns each reason into the wire refusal, so every transport answers the same way. Each
 * write asserts the writer lock, and an add or set answers with the record as stored.
 */

export interface ProjectAddInput {
  projectId: ProjectId;
  repoUrl: string;
  baseBranch: string;
  maxRunning: number;
  depPolicy: 'delivered' | 'merged';
}

/** The settings a project added without them gets: the same defaults `factory project add` uses. */
export const PROJECT_DEFAULTS = {
  baseBranch: 'main',
  maxRunning: 2,
  depPolicy: 'delivered',
} as const satisfies Omit<ProjectAddInput, 'projectId' | 'repoUrl'>;

const precondition = (detail: string): RuntimeError =>
  new RuntimeError({ code: 'precondition', detail });

/** Throws the refusal a store reason stands for; returns when the write was done. */
const throwUnlessDone = (
  result: ProjectStoreResult,
  projectId: ProjectId,
): void => {
  if (result.ok) return;
  switch (result.reason) {
    case 'exists':
      throw precondition(`project ${projectId} is already registered`);
    case 'missing':
      throw notFound();
    case 'has_history':
      throw precondition(
        `project ${projectId} has Work orders, events or intake rows and cannot be removed`,
      );
    case 'base_branch_busy':
      throw precondition(
        `project ${projectId} has a Work order that is not finished; its base branch changes once every Work order is delivered, merged or cancelled`,
      );
  }
};

/** The record as the store now holds it. A write the store accepted is always readable. */
const storedRecord = async (
  ports: RuntimePorts,
  projectId: ProjectId,
): Promise<ProjectRecord> => {
  const record = (await ports.projects.list()).find(
    (project) => project.projectId === projectId,
  );
  if (!record) throw notFound();
  return record;
};

/** The registry, sorted by project id as the store lists it. */
export const listProjects = async (
  ports: RuntimePorts,
): Promise<{ projects: ProjectRecord[] }> => ({
  projects: await ports.projects.list(),
});

/** Registers a project (PROTOCOL §3.1). An existing id is refused as `precondition`. */
export const addProject = async (
  ports: RuntimePorts,
  input: ProjectAddInput,
): Promise<{ project: ProjectRecord }> => {
  ports.writer.assertHeld();
  const result = await ports.projects.add(input, ports.clock.now());
  throwUnlessDone(result, input.projectId);
  return { project: await storedRecord(ports, input.projectId) };
};

/**
 * Makes sure a project is registered (PROTOCOL §3.1). An existing id is left as it is: its record keeps
 * its base branch, max running, dependency policy and repo url. A missing id is added with the given
 * settings. Two Cells that ensure the same id at once both succeed: the loser of the race reads the
 * winner's record.
 */
export const ensureProject = async (
  ports: RuntimePorts,
  input: { projectId: ProjectId; repoUrl: string },
): Promise<{ project: ProjectRecord; created: boolean }> => {
  ports.writer.assertHeld();
  const existing = (await ports.projects.list()).find(
    (project) => project.projectId === input.projectId,
  );
  if (existing) return { project: existing, created: false };
  const result = await ports.projects.add(
    { ...input, ...PROJECT_DEFAULTS },
    ports.clock.now(),
  );
  if (!result.ok && result.reason === 'exists') {
    return {
      project: await storedRecord(ports, input.projectId),
      created: false,
    };
  }
  throwUnlessDone(result, input.projectId);
  return { project: await storedRecord(ports, input.projectId), created: true };
};

/**
 * Changes a project's base branch, max running or dependency policy (PROTOCOL §3.1). The patch carries
 * only the fields the caller sent; `repoUrl` is not part of it.
 */
export const setProject = async (
  ports: RuntimePorts,
  projectId: ProjectId,
  patch: ProjectPatch,
): Promise<{ project: ProjectRecord }> => {
  ports.writer.assertHeld();
  throwUnlessDone(await ports.projects.set(projectId, patch), projectId);
  return { project: await storedRecord(ports, projectId) };
};

/** Removes a project with no history (PROTOCOL §3.1). */
export const removeProject = async (
  ports: RuntimePorts,
  projectId: ProjectId,
): Promise<{ projectId: ProjectId; removed: true }> => {
  ports.writer.assertHeld();
  throwUnlessDone(await ports.projects.remove(projectId), projectId);
  return { projectId, removed: true };
};
