import { Hono } from 'hono';
import { MAX_BODY_BYTES } from './config';
import type { AppEnv, CreateTransport } from './adapters/hono/types';
import { errorHandler, notFoundHandler } from './adapters/hono/error-handlers';
import {
  noCache,
  payloadLimit,
  requestId,
  transportMiddleware,
} from './adapters/hono/middlewares';
import { cellsRoute } from './adapters/hono/routes/cells.route';
import { factoriesRoute } from './adapters/hono/routes/factories.route';
import { incidentsRoute } from './adapters/hono/routes/incidents.route';
import { jobsRoute } from './adapters/hono/routes/jobs.route';
import { orderPlansRoute } from './adapters/hono/routes/order-plans.route';
import { projectsRoute } from './adapters/hono/routes/projects.route';
import { queueRoute } from './adapters/hono/routes/queue.route';
import { streamRoute } from './adapters/hono/routes/stream.route';
import { tokensRoute } from './adapters/hono/routes/tokens.route';
import { workOrdersRoute } from './adapters/hono/routes/work-orders.route';

export const createApp = (createTransport: CreateTransport) => {
  const app = new Hono<AppEnv>();
  app.use(
    '*',
    requestId,
    noCache,
    payloadLimit(MAX_BODY_BYTES),
    transportMiddleware(createTransport),
  );
  app.route('/api/v1/tokens', tokensRoute);
  app.route('/api/v1/projects', projectsRoute);
  app.route('/api/v1/order-plans', orderPlansRoute);
  app.route('/api/v1/work-orders', workOrdersRoute);
  app.route('/api/v1/queue', queueRoute);
  app.route('/api/v1/cells', cellsRoute);
  app.route('/api/v1/factories', factoriesRoute);
  app.route('/api/v1/jobs', jobsRoute);
  app.route('/api/v1/incidents', incidentsRoute);
  app.route('/api/v1/stream', streamRoute);
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  return app;
};
