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
      // A failed rotation falls back to one fresh join, per the auto-register rule.
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
  const { FACTORY_DATA_DIR: dataDir } = config;
  if (dataDir === undefined) {
    throw new Error('FACTORY_DATA_DIR is required to read the join secret');
  }
  return {
    baseUrl: config.FACTORY_URL,
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
  if (config.FACTORY_TOKEN !== undefined) return;
  const session = await acquireSession(sessionDeps(config));
  console.log(
    `web-demo: registered session, expires ${new Date(session.expiresAt).toISOString()}`,
  );
};

export const createSessionClient = async (
  env: Record<string, string | undefined>,
) => {
  const config = loadConfig(env);
  const token =
    config.FACTORY_TOKEN ?? (await currentToken(sessionDeps(config)));
  return {
    client: createFactoryClient({
      baseUrl: config.FACTORY_URL,
      getToken: () => token,
    }),
    projectId: config.FACTORY_PROJECT_ID,
  };
};
