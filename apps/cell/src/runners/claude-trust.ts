import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Claude Code's own config file. Its trust dialog reads the `hasTrustDialogAccepted` flag per project path. */
export const claudeConfigPathOf = (): string => join(homedir(), '.claude.json');

/**
 * Marks a folder as trusted in Claude Code's config, so an interactive start does not stop on the trust
 * dialog. Only that project entry changes; every other field of the file stays as it is.
 */
export const acceptClaudeTrust = (configPath: string, folder: string): void => {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const projects = (config.projects ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const entry = projects[folder] ?? {};
  if (entry.hasTrustDialogAccepted === true) return;
  const next = {
    ...config,
    projects: {
      ...projects,
      [folder]: { ...entry, hasTrustDialogAccepted: true },
    },
  };
  const tmp = `${configPath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, configPath);
};
