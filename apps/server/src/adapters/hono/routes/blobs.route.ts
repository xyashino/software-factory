import type { Hono } from 'hono';
import type { TransportContext } from '../../../application/core/procedure';
import { blobProcedures } from '../../../application/procedures/blobs.procedures';
import { mountProcedures } from '../adapter';

export const mountBlobRoutes = (app: Hono, transport: TransportContext): void =>
  mountProcedures(app, blobProcedures, transport);
