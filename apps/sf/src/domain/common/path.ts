const SEPARATOR = '/';

export const joinPath = (...parts: string[]): string =>
  parts
    .filter((part) => part.length > 0)
    .join(SEPARATOR)
    .replace(/\/{2,}/g, SEPARATOR);
