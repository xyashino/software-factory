import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_MACHINE_SETTINGS,
  type MachineSettings,
  validateMachineSettings,
} from './domain/settings/machine-settings';
import {
  parseSharedConfig,
  resolveSharedTarget,
  type SharedTarget,
} from './domain/factories/shared-target';

export const MAX_BODY_BYTES = 1_048_576;
const XDG_DATA_HOME =
  process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
const XDG_CONFIG_HOME =
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
export const DEFAULT_DB_PATH = join(XDG_DATA_HOME, 'sf', 'cell-server.db');
export const CELL_LOG_DIR = join(XDG_DATA_HOME, 'sf', 'cells');
export const SHARED_CONFIG_PATH = join(XDG_CONFIG_HOME, 'sf', 'config.json');
export const FACTORY_OVERRIDE_ENV = 'CELL_SERVER_FACTORY';

export const readMachineSettings = (
  env: Record<string, string | undefined>,
): MachineSettings =>
  validateMachineSettings({
    host: env.CELL_SERVER_HOST ?? DEFAULT_MACHINE_SETTINGS.host,
    port: Number(env.CELL_SERVER_PORT ?? DEFAULT_MACHINE_SETTINGS.port),
  });

export const readSharedTarget = (
  env: Record<string, string | undefined>,
  path: string = SHARED_CONFIG_PATH,
): SharedTarget | null => {
  const requested = env[FACTORY_OVERRIDE_ENV] || undefined;
  if (!existsSync(path)) {
    if (requested !== undefined)
      throw new Error(
        `no shared config at ${path} for ${FACTORY_OVERRIDE_ENV}`,
      );
    return null;
  }
  const config = parseSharedConfig(JSON.parse(readFileSync(path, 'utf8')));
  return resolveSharedTarget(config, requested);
};
