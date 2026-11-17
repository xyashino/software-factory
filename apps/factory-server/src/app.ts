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

export const createApp = (createTransport: CreateTransport) => {
  const app = new Hono<AppEnv>();
  app.use(
    '*',
    requestId,
    noCache,
    payloadLimit(MAX_BODY_BYTES),
    transportMiddleware(createTransport),
  );
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  return app;
};
