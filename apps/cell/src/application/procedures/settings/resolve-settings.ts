import type { SettingValue } from '../../../db/schema/settings';
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  type Settings,
  validateSettingsPatch,
} from '../../../domain/settings/preferences';

type SettingRow = { key: string; valueJson: SettingValue };

export const resolveSettings = (rows: SettingRow[]): Settings => ({
  ...DEFAULT_SETTINGS,
  ...validateSettingsPatch(
    Object.fromEntries(
      rows
        .filter((row) => (SETTING_KEYS as readonly string[]).includes(row.key))
        .map((row) => [row.key, row.valueJson]),
    ),
  ),
});
