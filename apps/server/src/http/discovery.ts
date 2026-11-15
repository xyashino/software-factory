import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  DISCOVERY_FILE_NAME,
  parseDiscovery,
  type Discovery,
} from '@repo/factory-core/contracts/discovery';

/** The discovery file's mode on POSIX: the operating-system account only (PROTOCOL §2). */
export const DISCOVERY_MODE = 0o600;

/** The discovery file inside a data directory. */
export const discoveryPathIn = (dataDir: string): string =>
  join(dataDir, DISCOVERY_FILE_NAME);

/**
 * Writes the discovery file atomically: the content goes to a temporary file in the same directory,
 * which is then renamed over the target. A reader sees the old file or the new one, never half of
 * one. The mode is tightened on POSIX; Windows has no such mode, so the file is left as the account's.
 */
export const writeDiscovery = (dataDir: string, value: Discovery): void => {
  const target = discoveryPathIn(dataDir);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: DISCOVERY_MODE });
  if (process.platform !== 'win32') chmodSync(temporary, DISCOVERY_MODE);
  renameSync(temporary, target);
};

/**
 * Removes the discovery file on a clean shutdown, but only while it still names this server's token:
 * a file another server wrote since is left alone. A missing or unreadable file is nothing to remove.
 */
export const removeDiscovery = (dataDir: string, token: string): void => {
  const target = discoveryPathIn(dataDir);
  if (!existsSync(target)) return;
  const current = parseDiscovery(readFileSync(target, 'utf8'));
  if (current?.token !== token) return;
  unlinkSync(target);
};
