import { getSettingsContract } from '../../../contracts/settings.contract';
import { settings } from '../../../db/schema/settings';
import { publicProcedure } from '../../core/procedure';
import { resolveSettings } from './resolve-settings';

export const getSettingsProcedure = publicProcedure(getSettingsContract)(
  (_input, ctx) => ({
    code: 200 as const,
    settings: resolveSettings(ctx.db.select().from(settings).all()),
  }),
);
