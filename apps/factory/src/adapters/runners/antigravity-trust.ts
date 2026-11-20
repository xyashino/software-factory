import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Antigravity CLI settings. Its trust dialog reads the `trustedWorkspaces` list of folder paths. */
export const antigravitySettingsPathOf = (): string =>
  join(homedir(), '.gemini', 'antigravity-cli', 'settings.json');

/**
 * Adds a folder to Antigravity's trusted workspaces, so an interactive start does not stop on the trust
 * dialog. Every other setting stays as it is.
 */
export const acceptAntigravityTrust = (
  settingsPath: string,
  folder: string,
): void => {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const trusted = Array.isArray(settings.trustedWorkspaces)
    ? settings.trustedWorkspaces.filter(
        (item): item is string => typeof item === 'string',
      )
    : [];
  if (trusted.includes(folder)) return;
  const next = { ...settings, trustedWorkspaces: [...trusted, folder] };
  const tmp = `${settingsPath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, settingsPath);
};
