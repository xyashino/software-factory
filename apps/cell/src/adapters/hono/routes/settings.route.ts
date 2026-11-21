import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { getSettingsProcedure } from '../../../application/procedures/settings/get-settings.procedure';
import { patchSettingsProcedure } from '../../../application/procedures/settings/patch-settings.procedure';

export const settingsRoute = new Hono<AppEnv>()
  .get('/', honoAdapter(getSettingsProcedure))
  .patch('/', honoAdapter(patchSettingsProcedure));
