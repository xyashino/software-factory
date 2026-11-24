export const ALLOWED_WEB_ACTIONS = [
  'pause',
  'unpause',
  'resume',
  'cancel',
] as const;

export type AllowedWebAction = (typeof ALLOWED_WEB_ACTIONS)[number];

export const isAllowedWebAction = (value: string): value is AllowedWebAction =>
  (ALLOWED_WEB_ACTIONS as readonly string[]).includes(value);

export const isSameOrigin = (
  originHeader: string | null,
  requestUrl: string,
  hostHeader: string | null,
): boolean => {
  if (originHeader === null || hostHeader === null) return false;
  try {
    const expected = `${new URL(requestUrl).protocol}//${hostHeader}`;
    return new URL(originHeader).origin === new URL(expected).origin;
  } catch {
    return false;
  }
};
