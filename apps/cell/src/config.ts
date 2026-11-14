import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { projectIdSchema, type ProjectId } from '@repo/factory-core/ids';

/** The Cell's config file: `~/.config/factory-cell/config.toml` (or under `$XDG_CONFIG_HOME`). */
export const configPath = (env: NodeJS.ProcessEnv): string =>
  join(
    env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'factory-cell',
    'config.toml',
  );

/** The Cell's own data directory: mirrors, worktrees and the identity file (`~/.local/share/factory-cell`). */
export const cellDataDirOf = (env: NodeJS.ProcessEnv): string =>
  env.XDG_DATA_HOME
    ? join(env.XDG_DATA_HOME, 'factory-cell')
    : join(homedir(), '.local', 'share', 'factory-cell');

/** Default slots: one Cell process runs this many Jobs at once unless the config says otherwise. */
export const DEFAULT_SLOTS = 2;

const cellConfigSchema = z
  .object({
    slots: z.number().int().min(1).max(64).default(DEFAULT_SLOTS),
    projects: z.array(projectIdSchema).max(64).default([]),
    runners: z.array(z.string().min(1).max(64)).max(32).default([]),
    capabilities: z.array(z.string().min(1).max(64)).max(32).default([]),
    /** The data directory of the local `factory-server`, which holds `factory.sock`. */
    factory_data_dir: z.string().min(1).optional(),
    /** Where the Cell keeps its mirrors, worktrees and identity. */
    cell_data_dir: z.string().min(1).optional(),
    /** Worktrees kept on disk before the least recently used are evicted. */
    worktree_limit: z.number().int().min(1).max(256).default(8),
  })
  .strict();

export interface CellConfig {
  slots: number;
  projects: ProjectId[];
  runners: string[];
  capabilities: string[];
  factoryDataDir?: string;
  cellDataDir?: string;
  worktreeLimit: number;
}

/** Parses the TOML text of a config file. Unknown keys and wrong types are refused, with the path named. */
export const parseConfig = (text: string): CellConfig => {
  const parsed = cellConfigSchema.safeParse(Bun.TOML.parse(text));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `config.toml: ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`,
    );
  }
  const data = parsed.data;
  return {
    slots: data.slots,
    projects: data.projects,
    runners: data.runners,
    capabilities: data.capabilities,
    factoryDataDir: data.factory_data_dir,
    cellDataDir: data.cell_data_dir,
    worktreeLimit: data.worktree_limit,
  };
};

/** The config at `path`; a missing file is an empty config (defaults only, no projects). */
export const readConfig = (path: string): CellConfig => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return parseConfig('');
    }
    throw error;
  }
  return parseConfig(text);
};
