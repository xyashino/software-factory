import { createMiddleware } from 'hono/factory';
import { PayloadTooLarge } from '../../application/core/error-handling';
import type { AppEnv, CreateTransport } from './types';

const bodyExceeds = async (request: Request, maxBytes: number) => {
  const body = request.clone().body;
  if (body === null) return false;
  const reader = body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return false;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return true;
    }
  }
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
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > maxBytes || (await bodyExceeds(c.req.raw, maxBytes)))
      throw new PayloadTooLarge(`Body exceeds ${maxBytes} bytes`);
    await next();
  });

export const transportMiddleware = (createTransport: CreateTransport) =>
  createMiddleware<AppEnv>(async (c, next) => {
    c.set(
      'transport',
      createTransport({
        signal: c.req.raw.signal,
        remoteAddress: c.env?.remoteAddress ?? null,
      }),
    );
    await next();
  });
