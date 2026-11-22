import { z } from 'zod';
import {
  getSettingsContract,
  patchSettingsContract,
} from '@repo/cell-contracts/settings.contract';
import { define } from '../../core/procedure';
import { checkedReply } from './checked-reply';
import { SETTING_KEYS, type Settings, SettingsReplySchema } from './shapes';

const SETTINGS_ROUTE = '/api/v1/settings';

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
    const reply = await ctx.cellServer.get(SETTINGS_ROUTE);
    return checkedReply(
      SETTINGS_ROUTE,
      getSettingsContract,
      SettingsReplySchema,
      reply,
    ).settings;
  },
);

export const setSettings = define({ kind: 'supervisor' })(SetSchema)<Settings>(
  async (input, ctx) => {
    const body: z.input<typeof patchSettingsContract.in.body> = {
      [input.key]: valueOf(input.value),
    };
    const reply = await ctx.cellServer.patch(SETTINGS_ROUTE, body);
    return checkedReply(
      SETTINGS_ROUTE,
      patchSettingsContract,
      SettingsReplySchema,
      reply,
    ).settings;
  },
);
