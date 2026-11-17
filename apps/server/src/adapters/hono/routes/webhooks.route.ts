import type { Hono } from 'hono';
import type { TransportContext } from '../../../application/core/procedure';
import { githubWebhookProcedure } from '../../../application/procedures/webhooks.procedures';
import { mountProcedures } from '../adapter';

export const mountWebhookRoutes = (
  app: Hono,
  transport: TransportContext,
  githubWebhookSecret: string | undefined,
): void =>
  mountProcedures(
    app,
    [githubWebhookProcedure(githubWebhookSecret)],
    transport,
  );
