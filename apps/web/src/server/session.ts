import { readFile } from 'node:fs/promises';
import {
  type JoinDeps,
  registerSession,
  rotateSession,
  type Session,
} from './auto-register';
import { type Config, loadConfig } from './config';
import { createFactoryClient } from './factory-client';
import { FactoryUnavailable } from './factory-error';

const ROTATE_BEFORE_MS = 60 * 60 * 1000;

const holder: { session?: Session } = {};

export type SessionDeps = JoinDeps & { clock: () => number };

const needsRotation = (session: Session, now: number): boolean =>
  session.expiresAt - now < ROTATE_BEFORE_MS;

const renewSession = async (
  deps: SessionDeps,
  previous: Session | undefined,
): Promise<Session> => {
  if (previous !== undefined) {
    try {
      return await rotateSession(deps.baseUrl, previous);
    } catch {
      // Failed rotation falls back to one fresh join.
    }
  }
  return registerSession(deps);
};

const acquireSession = async (deps: SessionDeps): Promise<Session> => {
  const { session } = holder;
  if (session !== undefined && !needsRotation(session, deps.clock())) {
    return session;
  }
  const next = await renewSession(deps, session);
  holder.session = next;
  return next;
};

const sessionDeps = (config: Config): SessionDeps => {
  const { HQ_DATA_DIR: dataDir } = config;
  if (dataDir === undefined) {
    throw new Error('HQ_DATA_DIR is required to read the join secret');
  }
  return {
    baseUrl: config.HQ_URL,
    dataDir,
    read: (path) => readFile(path, 'utf8'),
    clock: Date.now,
  };
};

export const currentToken = (deps: SessionDeps): Promise<string> =>
  acquireSession(deps).then(
    ({ token }) => token,
    () => {
      throw new FactoryUnavailable(0);
    },
  );

export const startSession = async (
  env: Record<string, string | undefined>,
): Promise<void> => {
  const config = loadConfig(env);
  if (config.HQ_TOKEN !== undefined) return;
  const session = await acquireSession(sessionDeps(config));
  console.log(
    `web: registered session, expires ${new Date(session.expiresAt).toISOString()}`,
  );
};

export const resolveSessionAuth = async (
  env: Record<string, string | undefined>,
): Promise<{ baseUrl: string; token: string; projectId: string }> => {
  const config = loadConfig(env);
  const token = config.HQ_TOKEN ?? (await currentToken(sessionDeps(config)));
  return {
    baseUrl: config.HQ_URL,
    token,
    projectId: config.HQ_PROJECT_ID,
  };
};

export const createSessionClient = async (
  env: Record<string, string | undefined>,
) => {
  const { baseUrl, token, projectId } = await resolveSessionAuth(env);
  return {
    client: createFactoryClient({
      baseUrl,
      getToken: () => token,
    }),
    projectId,
  };
};
