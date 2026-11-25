import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { getVersionProcedure } from '../../../application/procedures/version/get-version.procedure';

export const versionRoute = new Hono<AppEnv>().get(
  '/',
  honoAdapter(getVersionProcedure),
);
