import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The keys of the config file (PROTOCOL §10, STORAGE §1). `remoteUrl` selects remote mode; the token
 * is never a file key, it comes from `FACTORY_TOKEN` only, so it is not written to disk.
 */
export interface FileConfig {
  dataDir?: string;
  serverBin?: string;
  color?: boolean;
  remoteUrl?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const KEYS = new Set(['dataDir', 'serverBin', 'color', 'remoteUrl']);

/** The config file: `$FACTORY_CONFIG`, else `$XDG_CONFIG_HOME/factory/config.json`. */
export const configFilePath = (env: NodeJS.ProcessEnv): string =>
  env.FACTORY_CONFIG ??
  join(
    env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'factory',
    'config.json',
  );

/** Checks a parsed config file: known keys only, each with its type. Throws `ConfigError`. */
export const parseFileConfig = (value: unknown): FileConfig => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError('the config file must be a JSON object');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KEYS.has(key)) throw new ConfigError(`unknown config key "${key}"`);
  }
  const config: FileConfig = {};
  for (const key of ['dataDir', 'serverBin', 'remoteUrl'] as const) {
    const entry = record[key];
    if (entry === undefined) continue;
    if (typeof entry !== 'string' || entry === '') {
      throw new ConfigError(`config key "${key}" must be a non-empty string`);
    }
    config[key] = entry;
  }
  if (record.color !== undefined) {
    if (typeof record.color !== 'boolean') {
      throw new ConfigError('config key "color" must be true or false');
    }
    config.color = record.color;
  }
  return config;
};

/** Reads the config file; a missing file is an empty config. */
export const readFileConfig = (path: string): FileConfig => {
  if (!existsSync(path)) return {};
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new ConfigError(`the config file ${path} is not valid JSON`);
  }
  return parseFileConfig(json);
};

export interface Settings {
  dataDir: string;
  serverBin: string;
  color: boolean;
  /** Set when the CLI talks to a remote server over HTTP (PROTOCOL §2). Undefined means local mode. */
  remoteUrl?: string;
  /** The supervisor token of remote mode, from `FACTORY_TOKEN`. */
  token?: string;
}

export interface SettingsInput {
  flags: { dataDir?: string; noColor?: boolean };
  env: NodeJS.ProcessEnv;
  file: FileConfig;
  defaultServerBin: string;
}

/**
 * The settings in force, by precedence (PROTOCOL §10): a flag, then the environment, then the config
 * file, then the default. Remote mode is on when `FACTORY_URL` or `remoteUrl` names a server; the
 * default is local, the socket of the data directory. Colour is off with `--no-color`, with `NO_COLOR` set to a non-empty value,
 * or with `"color": false` in the config file.
 */
export const resolveSettings = (input: SettingsInput): Settings => {
  const remoteUrl = input.env.FACTORY_URL || input.file.remoteUrl;
  const token = input.env.FACTORY_TOKEN || undefined;
  return {
    dataDir:
      input.flags.dataDir ||
      input.env.FACTORY_DATA_DIR ||
      input.file.dataDir ||
      join(homedir(), '.local', 'share', 'factory'),
    serverBin: input.file.serverBin ?? input.defaultServerBin,
    color:
      !input.flags.noColor && !input.env.NO_COLOR && input.file.color !== false,
    ...(remoteUrl ? { remoteUrl } : {}),
    ...(token !== undefined ? { token } : {}),
  };
};
