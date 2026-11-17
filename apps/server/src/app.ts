import { Hono } from 'hono';
import { errorHandler, notFoundHandler } from './adapters/hono/error-handlers';
import { mountAdminRoutes } from './adapters/hono/routes/admin.route';
import { mountBlobRoutes } from './adapters/hono/routes/blobs.route';
import { mountCellRoutes } from './adapters/hono/routes/cells.route';
import { mountOrderRoutes } from './adapters/hono/routes/orders.route';
import { mountPlanRoutes } from './adapters/hono/routes/plans.route';
import { mountProjectRoutes } from './adapters/hono/routes/projects.route';
import { mountStreamRoute } from './adapters/hono/routes/stream.route';
import { mountWebhookRoutes } from './adapters/hono/routes/webhooks.route';
import type { TransportContext } from './application/core/procedure';

export interface AppOptions {
  readonly githubWebhookSecret?: string;
}

/**
 * The HTTP app over one transport (PROTOCOL §2, §3): every route of `HTTP_ROUTES` is mounted by its
 * domain route module, errors leave through one handler, and an unknown path answers 404 `not_found`.
 */
export const createApp = (
  transport: TransportContext,
  options: AppOptions = {},
): Hono => {
  const app = new Hono();
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  mountOrderRoutes(app, transport);
  mountPlanRoutes(app, transport);
  mountCellRoutes(app, transport);
  mountProjectRoutes(app, transport);
  mountBlobRoutes(app, transport);
  mountAdminRoutes(app, transport);
  mountWebhookRoutes(app, transport, options.githubWebhookSecret);
  mountStreamRoute(app, transport);
  return app;
};
