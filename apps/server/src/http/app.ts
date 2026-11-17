import type { Hono } from 'hono';
import type { Runtime } from '@repo/factory-runtime/composition';
import { createApp } from '../app';
import { createTransport } from '../bootstrap/transport';

export { LOCAL_SUPERVISOR_NAME } from '../adapters/auth/auth.adapter';

/**
 * The HTTP app over one runtime, for the existing callers and tests: the runtime served over Hono, for
 * local and remote clients alike. The routes live in `app.ts`; this keeps the import path stable.
 */
export const createHttpApp = (
  runtime: Runtime,
  options: { githubWebhookSecret?: string; localToken?: string } = {},
): Hono =>
  createApp(createTransport({ runtime, localToken: options.localToken }), {
    githubWebhookSecret: options.githubWebhookSecret,
  });
