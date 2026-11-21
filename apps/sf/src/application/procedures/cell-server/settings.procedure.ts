import { z } from 'zod';
import { define } from '../../core/procedure';
import { SETTING_KEYS, type Settings, SettingsReplySchema } from './shapes';

const KeySchema = z.enum(SETTING_KEYS);

const GetSchema = z.object({ key: KeySchema.optional() }).strict();
const SetSchema = z.object({ key: KeySchema, value: z.string() }).strict();

const valueOf = (raw: string): string | number | boolean => {
  if (raw === 'true' || raw === 'false') {
    return raw === 'true';
  }
  const numeric = Number(raw);
  return raw.trim() !== '' && Number.isFinite(numeric) ? numeric : raw;
};

export const getSettings = define({ kind: 'supervisor' })(GetSchema)<Settings>(
  async (_input, ctx) => {
    const reply = await ctx.cellServer.get('/api/v1/settings');
    return SettingsReplySchema.parse(reply).settings;
  },
);

export const setSettings = define({ kind: 'supervisor' })(SetSchema)<Settings>(
  async (input, ctx) => {
    const reply = await ctx.cellServer.patch('/api/v1/settings', {
      [input.key]: valueOf(input.value),
    });
    return SettingsReplySchema.parse(reply).settings;
  },
);
