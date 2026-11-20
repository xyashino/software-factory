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
import { healthRoute } from './adapters/hono/routes/health.route';
import { factoriesRoute } from './adapters/hono/routes/factories.route';
import { settingsRoute } from './adapters/hono/routes/settings.route';
import { cellsRoute } from './adapters/hono/routes/cells.route';
import { streamRoute } from './adapters/hono/routes/stream.route';

export const createApp = (createTransport: CreateTransport) => {
  const app = new Hono<AppEnv>();
  app.use(
    '*',
    requestId,
    noCache,
    payloadLimit(MAX_BODY_BYTES),
    transportMiddleware(createTransport),
  );
  app.route('/api/v1/health', healthRoute);
  app.route('/api/v1/factories', factoriesRoute);
  app.route('/api/v1/settings', settingsRoute);
  app.route('/api/v1/cells', cellsRoute);
  app.route('/api/v1/stream', streamRoute);
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  return app;
};
