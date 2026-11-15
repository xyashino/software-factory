import { existsSync, readFileSync } from 'node:fs';
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

/** The key cell-single-order removed: one Cell runs one Work order, so the setting has no meaning now. */
const REMOVED_SLOTS_MESSAGE =
  'config.toml: slots: removed (one Cell runs one Work order at a time); run one Cell per instance directory (hostname-N) for parallel work';

/** Default worktrees kept on disk per repo before the least recently used are evicted. */
const DEFAULT_WORKTREE_LIMIT = 8;

/**
 * Every key of a config file, with no defaults: a file (or a repo's `.factory/cell.toml` or `.factory-local/cell.toml`) sets only the
 * keys it names. Unknown keys and wrong types are refused.
 */
const partialConfigSchema = z
  .object({
    projects: z.array(projectIdSchema).max(64).optional(),
    runners: z.array(z.string().min(1).max(64)).max(32).optional(),
    capabilities: z.array(z.string().min(1).max(64)).max(32).optional(),
    /** The data directory of the local `factory-server`, which holds `factory.sock`. */
    factory_data_dir: z.string().min(1).optional(),
    /** Where the Cell keeps its mirrors, worktrees and identity. */
    cell_data_dir: z.string().min(1).optional(),
    /** Worktrees kept on disk before the least recently used are evicted. */
    worktree_limit: z.number().int().min(1).max(256).optional(),
    /** Remote mode (PROTOCOL §2): the Factory's HTTP address. Unset means the local socket. */
    factory_url: z.string().url().optional(),
    /**
     * Runs every Operator station headless (the runner's print mode, no Herdr pane). Off by default:
     * Lines run their Operators in panes. Tests turn it on to run real Cell processes without Herdr.
     */
    headless_operators: z.boolean().optional(),
  })
  .strict();

/** A config file as written: only the keys it names. */
export type PartialConfig = z.infer<typeof partialConfigSchema>;

export interface CellConfig {
  projects: ProjectId[];
  runners: string[];
  capabilities: string[];
  factoryDataDir?: string;
  cellDataDir?: string;
  worktreeLimit: number;
  factoryUrl?: string;
  headlessOperators: boolean;
}

/**
 * Parses the TOML text of a config file, keeping only the keys it names. Unknown keys and wrong types
 * are refused, with the path named. `source` names the file in the message.
 */
export const parsePartialConfig = (
  text: string,
  source = 'config.toml',
): PartialConfig => {
  const raw: unknown = Bun.TOML.parse(text);
  if (typeof raw === 'object' && raw !== null && 'slots' in raw)
    throw new Error(REMOVED_SLOTS_MESSAGE);
  const parsed = partialConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `${source}: ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`,
    );
  }
  return parsed.data;
};

/** The effective config: defaults for every key no file names. */
export const toCellConfig = (partial: PartialConfig): CellConfig => ({
  projects: partial.projects ?? [],
  runners: partial.runners ?? [],
  capabilities: partial.capabilities ?? [],
  factoryDataDir: partial.factory_data_dir,
  cellDataDir: partial.cell_data_dir,
  worktreeLimit: partial.worktree_limit ?? DEFAULT_WORKTREE_LIMIT,
  headlessOperators: partial.headless_operators ?? false,
  ...(partial.factory_url !== undefined
    ? { factoryUrl: partial.factory_url }
    : {}),
});

/**
 * Parses the TOML text of a config file into the effective config (defaults applied). Unknown keys and
 * wrong types are refused, with the path named.
 */
export const parseConfig = (text: string): CellConfig =>
  toCellConfig(parsePartialConfig(text));

/** The partial config at `path`; a missing file names no keys. */
export const readPartialConfig = (path: string): PartialConfig => {
  if (!existsSync(path)) return {};
  return parsePartialConfig(readFileSync(path, 'utf8'), path);
};

/** The config at `path`; a missing file is an empty config (defaults only, no projects). */
export const readConfig = (path: string): CellConfig =>
  toCellConfig(readPartialConfig(path));
