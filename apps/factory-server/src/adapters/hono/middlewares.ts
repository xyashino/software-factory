import { createMiddleware } from 'hono/factory';
import { PayloadTooLarge } from '../../application/core/error-handling';
import type { AppEnv, CreateTransport } from './types';

const bearerOf = (header: string | undefined): string | null => {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  return match?.[1] ?? null;
};

export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const id = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', id);
  c.header('x-request-id', id);
  await next();
});

export const noCache = createMiddleware<AppEnv>(async (c, next) => {
  c.header('cache-control', 'no-store');
  await next();
});

export const payloadLimit = (maxBytes: number) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > maxBytes)
      throw new PayloadTooLarge(`Body exceeds ${maxBytes} bytes`);
    await next();
  });

export const transportMiddleware = (createTransport: CreateTransport) =>
  createMiddleware<AppEnv>(async (c, next) => {
    c.set(
      'transport',
      createTransport({
        bearer: bearerOf(c.req.header('authorization')),
        signal: c.req.raw.signal,
        remoteAddress: c.env?.remoteAddress ?? null,
      }),
    );
    await next();
  });
