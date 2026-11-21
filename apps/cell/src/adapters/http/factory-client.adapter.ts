import { BadGateway } from '../../application/core/error-handling';
import type {
  EnrollRequest,
  EnrolledCell,
  FactoryClientPort,
  ProjectSummary,
} from '../../application/ports/factory-client.port';

const JOIN_TOKEN_NAME = 'cell-server join';
const PROJECTS_PATH = '/api/v1/projects';

const failureOf = async (response: Response): Promise<BadGateway> => {
  const body = (await response.json().catch(() => null)) as {
    message?: unknown;
  } | null;
  const detail = typeof body?.message === 'string' ? body.message : '';
  return new BadGateway(
    `factory answered ${response.status}${detail ? `: ${detail}` : ''}`,
  );
};

const postJson = async (
  url: string,
  bearer: string,
  body: unknown,
): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new BadGateway(
      `factory unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw await failureOf(response);
  return response.json();
};

const getJson = async (url: string, bearer: string): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${bearer}` },
    });
  } catch (error) {
    throw new BadGateway(
      `factory unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw await failureOf(response);
  return response.json();
};

const isProjectSummary = (value: unknown): value is ProjectSummary =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { projectId?: unknown }).projectId === 'string' &&
  typeof (value as { repoUrl?: unknown }).repoUrl === 'string' &&
  typeof (value as { defaultBaseBranch?: unknown }).defaultBaseBranch ===
    'string';

const isProjectList = (
  value: unknown,
): value is { projects: ProjectSummary[] } =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { projects?: unknown }).projects) &&
  (value as { projects: unknown[] }).projects.every(isProjectSummary);

const isFactoryToken = (value: unknown): value is { token: string } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { token?: unknown }).token === 'string';

const isEnrolled = (value: unknown): value is EnrolledCell =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { cellId?: unknown }).cellId === 'string' &&
  typeof (value as { sessionToken?: unknown }).sessionToken === 'string';

export const createFactoryClient = (): FactoryClientPort => ({
  health: async (factory) => {
    try {
      const response = await fetch(`${factory.url}/api/v1/health`);
      return response.ok;
    } catch {
      return false;
    }
  },
  mintJoinToken: async (factoryUrl, supervisorToken) => {
    const reply = await postJson(
      `${factoryUrl}/api/v1/tokens`,
      supervisorToken,
      {
        kind: 'cell_join',
        name: JOIN_TOKEN_NAME,
      },
    );
    if (!isFactoryToken(reply))
      throw new BadGateway('factory returned no join token');
    return reply.token;
  },
  listProjects: async (factoryUrl, supervisorToken) => {
    const reply = await getJson(
      `${factoryUrl}${PROJECTS_PATH}`,
      supervisorToken,
    );
    if (!isProjectList(reply))
      throw new BadGateway('factory returned no project list');
    return reply.projects.map((project) => ({
      projectId: project.projectId,
      repoUrl: project.repoUrl,
      defaultBaseBranch: project.defaultBaseBranch,
    }));
  },
  enroll: async (factoryUrl, joinToken, request: EnrollRequest) => {
    const reply = await postJson(
      `${factoryUrl}/api/v1/cells/enroll`,
      joinToken,
      request,
    );
    if (!isEnrolled(reply))
      throw new BadGateway('factory returned no cell session');
    return { cellId: reply.cellId, sessionToken: reply.sessionToken };
  },
});
