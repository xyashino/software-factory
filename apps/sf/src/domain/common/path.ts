const SEPARATOR = '/';

export const joinPath = (...parts: string[]): string =>
  parts
    .filter((part) => part.length > 0)
    .join(SEPARATOR)
    .replace(/\/{2,}/g, SEPARATOR);

export const parentPath = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '');
  const index = trimmed.lastIndexOf(SEPARATOR);
  return index <= 0 ? SEPARATOR : trimmed.slice(0, index);
};
