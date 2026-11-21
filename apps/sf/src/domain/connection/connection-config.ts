import { z } from 'zod';

export const LOCAL_TARGET = 'local';
export const TARGET_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const SUPERVISOR_TOKEN_LABEL = 'repo:.factory-local/supervisor.token';
export const LEGACY_TOKEN_LABEL = 'legacy:~/.config/factory/token';

export const TargetNameSchema = z
  .string()
  .regex(
    TARGET_NAME_PATTERN,
    'target name must be lowercase letters, digits, - or _',
  );

const TargetSchema = z
  .object({ url: z.string().url(), token: z.string().min(1) })
  .strict();

export const ConnectionConfigSchema = z
  .object({
    current: z.string().min(1).nullable(),
    targets: z.record(z.string().min(1), TargetSchema),
  })
  .strict();

export const EMPTY_CONNECTION_CONFIG: ConnectionConfig = {
  current: null,
  targets: {},
};

export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;
export type ConnectionTarget = z.infer<typeof TargetSchema>;
export type UrlSource = 'env:FACTORY_URL' | 'default' | `config:${string}`;
export type TokenSource =
  | 'env:FACTORY_TOKEN'
  | typeof SUPERVISOR_TOKEN_LABEL
  | typeof LEGACY_TOKEN_LABEL
  | `config:${string}`;

export interface Connection {
  url: string;
  urlSource: UrlSource;
  token: string | null;
  tokenSource: TokenSource | null;
}

export interface ConnectionInputs {
  envUrl: string | undefined;
  envToken: string | undefined;
  repoToken: string | undefined;
  legacyToken: string | undefined;
  config: ConnectionConfig;
  defaultUrl: string;
}

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

const presentOf = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const activeOf = (
  config: ConnectionConfig,
): { name: string; target: ConnectionTarget } | undefined => {
  if (config.current === null) {
    return undefined;
  }
  const target = config.targets[config.current];
  return target === undefined ? undefined : { name: config.current, target };
};

const urlOf = (
  inputs: ConnectionInputs,
  active: ReturnType<typeof activeOf>,
): Pick<Connection, 'url' | 'urlSource'> => {
  const fromEnv = presentOf(inputs.envUrl);
  if (fromEnv !== undefined) {
    return { url: fromEnv, urlSource: 'env:FACTORY_URL' };
  }
  if (active !== undefined) {
    return { url: active.target.url, urlSource: `config:${active.name}` };
  }
  return { url: inputs.defaultUrl, urlSource: 'default' };
};

const tokenOf = (
  inputs: ConnectionInputs,
  active: ReturnType<typeof activeOf>,
): Pick<Connection, 'token' | 'tokenSource'> => {
  const fromEnv = presentOf(inputs.envToken);
  if (fromEnv !== undefined) {
    return { token: fromEnv, tokenSource: 'env:FACTORY_TOKEN' };
  }
  const fromRepo = presentOf(inputs.repoToken);
  if (fromRepo !== undefined) {
    return { token: fromRepo, tokenSource: SUPERVISOR_TOKEN_LABEL };
  }
  if (active !== undefined) {
    return { token: active.target.token, tokenSource: `config:${active.name}` };
  }
  const fromLegacy = presentOf(inputs.legacyToken);
  if (fromLegacy !== undefined) {
    return { token: fromLegacy, tokenSource: LEGACY_TOKEN_LABEL };
  }
  return { token: null, tokenSource: null };
};

export const resolveConnection = (inputs: ConnectionInputs): Connection => {
  const active = activeOf(inputs.config);
  return { ...urlOf(inputs, active), ...tokenOf(inputs, active) };
};

export const withTarget = (
  config: ConnectionConfig,
  name: string,
  target: ConnectionTarget,
  activate: boolean,
): ConnectionConfig => ({
  current: activate ? name : config.current,
  targets: { ...config.targets, [name]: target },
});

export const withoutTarget = (
  config: ConnectionConfig,
  name: string,
): ConnectionConfig => ({
  current: config.current === name ? null : config.current,
  targets: Object.fromEntries(
    Object.entries(config.targets).filter(([key]) => key !== name),
  ),
});

export const isLoopbackUrl = (url: string): boolean => {
  try {
    return LOOPBACK_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

export const normalizeUrl = (url: string): string => url.replace(/\/+$/, '');

export const defaultTargetNameOf = (url: string): string => {
  if (isLoopbackUrl(url)) {
    return LOCAL_TARGET;
  }
  return new URL(url).hostname
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 40);
};

export const recoveryCommandOf = (url: string): string =>
  isLoopbackUrl(url)
    ? 'sf server token create --save --global'
    : `sf connect ${url}`;
