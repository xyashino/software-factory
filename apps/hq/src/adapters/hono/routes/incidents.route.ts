import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { listIncidentsProcedure } from '../../../application/procedures/incidents/list-incidents.procedure';
import { resolveIncidentProcedure } from '../../../application/procedures/incidents/resolve-incident.procedure';

export const incidentsRoute = new Hono<AppEnv>()
  .get('/', honoAdapter(listIncidentsProcedure))
  .post('/:id/resolve', honoAdapter(resolveIncidentProcedure));
