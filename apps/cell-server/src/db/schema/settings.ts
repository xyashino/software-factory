import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { jsonColumn, timestamps } from '../columns';

export type SettingValue = string | number | boolean | null;

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: jsonColumn<SettingValue>('value_json').notNull(),
  ...timestamps(),
});
