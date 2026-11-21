export const RUNNERS = [
  'claude',
  'codex',
  'cursor',
  'antigravity',
  'opencode',
] as const;

export const SETTING_KEYS = [
  'herdr_enabled',
  'default_runner',
  'restart_backoff_ms',
  'max_local_cells',
  'git_fetch_on_worktree',
] as const;

export const DEFAULT_SETTINGS: Settings = {
  herdr_enabled: false,
  default_runner: 'claude',
  restart_backoff_ms: 1000,
  max_local_cells: 4,
  git_fetch_on_worktree: true,
};

const RESTART_BACKOFF_MS_MAX = 600_000;
const MAX_LOCAL_CELLS_MAX = 64;

export type Runner = (typeof RUNNERS)[number];

export type SettingKey = (typeof SETTING_KEYS)[number];

export type Settings = {
  herdr_enabled: boolean;
  default_runner: Runner;
  restart_backoff_ms: number;
  max_local_cells: number;
  git_fetch_on_worktree: boolean;
};

export type SettingsPatch = Partial<Settings>;

const isSettingKey = (key: string): key is SettingKey =>
  (SETTING_KEYS as readonly string[]).includes(key);

const isRunner = (value: unknown): value is Runner =>
  (RUNNERS as readonly unknown[]).includes(value);

const booleanOf = (key: SettingKey, value: unknown): boolean => {
  if (typeof value !== 'boolean')
    throw new RangeError(`${key} must be a boolean`);
  return value;
};

const integerIn = (
  key: SettingKey,
  value: unknown,
  min: number,
  max: number,
): number => {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new RangeError(`${key} must be an integer from ${min} to ${max}`);
  if (value < min || value > max)
    throw new RangeError(`${key} must be an integer from ${min} to ${max}`);
  return value;
};

const runnerOf = (value: unknown): Runner => {
  if (!isRunner(value))
    throw new RangeError(`default_runner must be one of ${RUNNERS.join(', ')}`);
  return value;
};

const valueOf = (key: SettingKey, value: unknown): Settings[SettingKey] => {
  switch (key) {
    case 'herdr_enabled':
      return booleanOf(key, value);
    case 'default_runner':
      return runnerOf(value);
    case 'restart_backoff_ms':
      return integerIn(key, value, 0, RESTART_BACKOFF_MS_MAX);
    case 'max_local_cells':
      return integerIn(key, value, 0, MAX_LOCAL_CELLS_MAX);
    case 'git_fetch_on_worktree':
      return booleanOf(key, value);
  }
};

export const validateSettingsPatch = (
  input: Record<string, unknown>,
): SettingsPatch =>
  Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (!isSettingKey(key)) throw new RangeError(`unknown setting: ${key}`);
      return [key, valueOf(key, value)];
    }),
  ) as SettingsPatch;
