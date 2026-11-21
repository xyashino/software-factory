import { z } from 'zod';

export const SETTING_KEYS = [
  'herdr_enabled',
  'default_runner',
  'restart_backoff_ms',
  'max_local_cells',
  'git_fetch_on_worktree',
] as const;

export const SettingsSchema = z.object({
  herdr_enabled: z.boolean(),
  default_runner: z.string(),
  restart_backoff_ms: z.number(),
  max_local_cells: z.number(),
  git_fetch_on_worktree: z.boolean(),
});

export const FactorySchema = z.object({
  factoryId: z.string(),
  name: z.string(),
  url: z.string(),
  isDefault: z.boolean(),
  hasJoinToken: z.boolean(),
  hasSupervisorToken: z.boolean(),
});

export const SettingsReplySchema = z.object({ settings: SettingsSchema });
export const FactoryReplySchema = z.object({ factory: FactorySchema });
export const FactoriesReplySchema = z.object({
  factories: z.array(FactorySchema),
});

export type SettingKey = (typeof SETTING_KEYS)[number];
export type Settings = z.infer<typeof SettingsSchema>;
export type Factory = z.infer<typeof FactorySchema>;
