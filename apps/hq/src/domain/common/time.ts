export const addMs = (epochMs: number, deltaMs: number): number =>
  epochMs + deltaMs;

export const isExpired = (expiresAtMs: number, nowMs: number): boolean =>
  nowMs >= expiresAtMs;
