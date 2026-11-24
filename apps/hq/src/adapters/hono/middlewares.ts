import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { PayloadTooLarge } from '../../application/core/error-handling';
import { asCellId, type CellId } from '../../domain/common/brand';
import type { RateLimiter } from '../memory/rate-limit.adapter';
import type { AppEnv, CreateTransport } from './types';

const bearerOf = (header: string | undefined): string | null => {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  return match?.[1] ?? null;
};

const clientIpOf = (c: Context<AppEnv>): string =>
  c.env?.remoteAddress ?? 'unknown';

const tooManyRequests = (c: Context<AppEnv>, retryAfterSeconds: number) => {
  c.header('retry-after', String(retryAfterSeconds));
  return c.json(
    {
      code: 429,
      type: 'too-many-requests',
      message: 'Too many requests, retry later',
    },
    429,
  );
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

const cellIdOf = (header: string | undefined): CellId | null => {
  const value = header?.trim() ?? '';
  return value === '' ? null : asCellId(value);
};

export const authFailureBrake = (limiter: RateLimiter) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const clientIp = clientIpOf(c);
    const verdict = limiter.checkAuthBrake(clientIp);
    if (!verdict.allowed) return tooManyRequests(c, verdict.retryAfterSeconds);
    await next();
    if (c.res.status === 401 || c.res.status === 403)
      limiter.recordAuthFailure(clientIp);
    return undefined;
  });

export const tokenQuota = (limiter: RateLimiter) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const bearer = bearerOf(c.req.header('authorization'));
    if (bearer !== null) {
      const verdict = limiter.admitToken(bearer);
      if (!verdict.allowed)
        return tooManyRequests(c, verdict.retryAfterSeconds);
    }
    return next();
  });

export const transportMiddleware = (createTransport: CreateTransport) =>
  createMiddleware<AppEnv>(async (c, next) => {
    c.set(
      'transport',
      createTransport({
        bearer: bearerOf(c.req.header('authorization')),
        cellId: cellIdOf(c.req.header('x-cell-id')),
        signal: c.req.raw.signal,
        remoteAddress: c.env?.remoteAddress ?? null,
      }),
    );
    await next();
  });
