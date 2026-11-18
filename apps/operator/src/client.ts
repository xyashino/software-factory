import { okReplySchema, replySchemas } from '@repo/operator-protocol/replies';
import type { ArgumentError, Result } from './exit-codes';

const TIMEOUT_MS = 10_000;

const REFUSED_STATUSES = [400, 401, 409, 500] as const;

const UNREACHABLE: Result = {
  kind: 'unreachable',
  message: 'endpoint unreachable',
};

const UNREADABLE: Result = {
  kind: 'unreachable',
  message: 'reply cannot be read',
};

type RefusedStatus = (typeof REFUSED_STATUSES)[number];

export type Env = Record<string, string | undefined>;

export type Fields = { verb: string } & Record<string, unknown>;

type Config = { url: string; token: string };

type ConfigRead = { kind: 'ok'; config: Config } | ArgumentError;

const isRefusedStatus = (status: number): status is RefusedStatus =>
  REFUSED_STATUSES.some((refused) => refused === status);

const readConfig = (env: Env): ConfigRead => {
  const url = env.FACTORY_OPERATOR_URL;
  const token = env.FACTORY_CYCLE_TOKEN;
  if (!url) {
    return {
      kind: 'argument_error',
      message: 'FACTORY_OPERATOR_URL is not set',
    };
  }
  if (!token) {
    return {
      kind: 'argument_error',
      message: 'FACTORY_CYCLE_TOKEN is not set',
    };
  }
  try {
    new URL(url);
  } catch {
    return {
      kind: 'argument_error',
      message: 'FACTORY_OPERATOR_URL is not a valid URL',
    };
  }
  return { kind: 'ok', config: { url, token } };
};

const mapReply = async (response: Response): Promise<Result> => {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return UNREADABLE;
  }

  const status = response.status;
  if (status === 200) {
    return okReplySchema.safeParse(raw).success ? { kind: 'ok' } : UNREADABLE;
  }

  if (!isRefusedStatus(status)) {
    return UNREADABLE;
  }
  const parsed = replySchemas[status].safeParse(raw);
  if (!parsed.success || parsed.data.ok) {
    return UNREADABLE;
  }
  return {
    kind: 'refused',
    code: parsed.data.code,
    message: parsed.data.message,
  };
};

export const sendRequest = async (
  fields: Fields,
  env: Env,
  timeoutMs: number = TIMEOUT_MS,
): Promise<Result> => {
  const read = readConfig(env);
  if (read.kind === 'argument_error') {
    return read;
  }
  const { url, token } = read.config;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...fields, token }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return UNREACHABLE;
  }
  return mapReply(response);
};
