import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_MACHINE_SETTINGS,
  type MachineSettings,
  validateMachineSettings,
} from './domain/settings/machine-settings';

export const MAX_BODY_BYTES = 1_048_576;
const XDG_DATA_HOME =
  process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
export const DEFAULT_DB_PATH = join(XDG_DATA_HOME, 'sf', 'cell-server.db');

export const readMachineSettings = (
  env: Record<string, string | undefined>,
): MachineSettings =>
  validateMachineSettings({
    host: env.CELL_SERVER_HOST ?? DEFAULT_MACHINE_SETTINGS.host,
    port: Number(env.CELL_SERVER_PORT ?? DEFAULT_MACHINE_SETTINGS.port),
  });
