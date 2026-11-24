import { join } from 'node:path';
import { z } from 'zod';

const JOIN_PATH = '/api/v1/tokens/join';
const ROTATE_PATH = '/api/v1/tokens/rotate';
const JOIN_FILE = 'web-demo.join';
const REQUEST_TIMEOUT_MS = 5_000;

const sessionReplySchema = z.object({
  token: z.string(),
  expiresAt: z.number().int(),
});
const refusalSchema = z.object({ code: z.number(), message: z.string() });

export type Session = { token: string; expiresAt: number };

export type JoinDeps = {
  baseUrl: string;
  dataDir: string;
  read: (path: string) => Promise<string>;
};

const readJoinSecret = async (
  deps: JoinDeps,
  path: string,
): Promise<string> => {
  try {
    return (await deps.read(path)).trim();
  } catch {
    throw new Error(
      `cannot read join secret at ${path}: start HQ with this HQ_DATA_DIR`,
    );
  }
};

const postJson = (
  baseUrl: string,
  path: string,
  body: object,
  token?: string,
): Promise<Response> =>
  fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

const refusalMessage = async (response: Response): Promise<string> => {
  const parsed = refusalSchema.safeParse(
    await response.json().catch(() => null),
  );
  return parsed.success
    ? `${String(parsed.data.code)}: ${parsed.data.message}`
    : `HQ refused the request (status ${String(response.status)})`;
};

const readSession = async (response: Response): Promise<Session> => {
  const parsed = sessionReplySchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) {
    throw new Error('HQ returned an unexpected session reply');
  }
  return parsed.data;
};

export const registerSession = async (deps: JoinDeps): Promise<Session> => {
  const joinSecret = await readJoinSecret(deps, join(deps.dataDir, JOIN_FILE));
  const response = await postJson(deps.baseUrl, JOIN_PATH, { joinSecret });
  if (!response.ok) throw new Error(await refusalMessage(response));
  return readSession(response);
};

export const rotateSession = async (
  baseUrl: string,
  session: Session,
): Promise<Session> => {
  const response = await postJson(baseUrl, ROTATE_PATH, {}, session.token);
  if (!response.ok) throw new Error(await refusalMessage(response));
  return readSession(response);
};
