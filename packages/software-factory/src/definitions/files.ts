import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Lists files with the given extension in `<root>/<dir>`, sorted, as paths
 * relative to the root. Returns null when the directory cannot be read.
 */
export const listFiles = (
  root: string,
  dir: string,
  extension: string,
): string[] | null => {
  let names: string[];
  try {
    names = readdirSync(join(root, dir));
  } catch {
    return null;
  }
  return names
    .filter((name) => name.endsWith(extension))
    .sort()
    .map((name) => `${dir}/${name}`);
};
