import { DEFAULT_RATE_LIMITS } from '../../config';
import type { ClockPort } from '../../application/ports/clock.port';
import { hashToken } from '../../application/tokens/token-hash';

const ALLOWED: Verdict = { allowed: true };
const TOKEN_KEY_LENGTH = 16;

export type WindowLimit = { limit: number; windowMs: number };

export type RateLimitSettings = {
  tokenQuota: WindowLimit;
  authFailureBrake: WindowLimit;
};

export type Verdict =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

export type RateLimiter = {
  admitToken(bearer: string): Verdict;
  checkAuthBrake(clientIp: string): Verdict;
  recordAuthFailure(clientIp: string): void;
};

type Window = { startedAt: number; count: number };

type Windows = {
  find(key: string): Window | undefined;
  open(key: string): Window;
  retryAfterSeconds(window: Window): number;
};

const tokenKeyOf = (bearer: string): string =>
  hashToken(bearer).slice(0, TOKEN_KEY_LENGTH);

const createWindows = (clock: ClockPort, windowMs: number): Windows => {
  const windows = new Map<string, Window>();
  let prunedAt = clock.now();
  const liveAt = (key: string, now: number): Window | undefined => {
    const window = windows.get(key);
    return window !== undefined && now - window.startedAt < windowMs
      ? window
      : undefined;
  };
  return {
    find: (key) => liveAt(key, clock.now()),
    open: (key) => {
      const now = clock.now();
      if (now - prunedAt >= windowMs) {
        prunedAt = now;
        for (const [stale, window] of windows)
          if (now - window.startedAt >= windowMs) windows.delete(stale);
      }
      const live = liveAt(key, now);
      if (live !== undefined) return live;
      const fresh = { startedAt: now, count: 0 };
      windows.set(key, fresh);
      return fresh;
    },
    retryAfterSeconds: (window) =>
      Math.max(
        1,
        Math.ceil((window.startedAt + windowMs - clock.now()) / 1000),
      ),
  };
};

export const createRateLimiter = (
  clock: ClockPort,
  settings: RateLimitSettings = DEFAULT_RATE_LIMITS,
): RateLimiter => {
  const quotas = createWindows(clock, settings.tokenQuota.windowMs);
  const brakes = createWindows(clock, settings.authFailureBrake.windowMs);
  return {
    admitToken: (bearer) => {
      const window = quotas.open(tokenKeyOf(bearer));
      if (window.count >= settings.tokenQuota.limit)
        return {
          allowed: false,
          retryAfterSeconds: quotas.retryAfterSeconds(window),
        };
      window.count += 1;
      return ALLOWED;
    },
    checkAuthBrake: (clientIp) => {
      const window = brakes.find(clientIp);
      if (
        window !== undefined &&
        window.count >= settings.authFailureBrake.limit
      )
        return {
          allowed: false,
          retryAfterSeconds: brakes.retryAfterSeconds(window),
        };
      return ALLOWED;
    },
    recordAuthFailure: (clientIp) => {
      brakes.open(clientIp).count += 1;
    },
  };
};
