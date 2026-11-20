import { BadGateway } from '../../application/core/error-handling';
import type {
  EnrollRequest,
  EnrolledCell,
  FactoryClientPort,
} from '../../application/ports/factory-client.port';

const JOIN_TOKEN_NAME = 'cell-server join';

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
