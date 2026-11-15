import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACTORY_DIR } from './load';

/** The starter `.factory/` tree this package ships: what `factory init` copies into a repository. */
export const STARTER_ROOT = fileURLToPath(
  new URL('../starter/.factory', import.meta.url),
);

/** The files of the starter tree, as paths relative to it, sorted. */
export const starterFiles = (root: string = STARTER_ROOT): string[] => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        files.push(path.slice(root.length + 1));
      }
    }
  };
  walk(root);
  return files;
};

/** What `scaffoldFactory` did: the files it wrote, relative to the `.factory/` directory. */
export interface ScaffoldResult {
  written: string[];
}

/**
 * Copies the starter `.factory/` tree into `<repoRoot>/.factory/`. A repository that already has one is
 * refused unless `force` is set; with `force`, only the starter's own files are overwritten and any
 * other file in the directory is kept.
 */
export const scaffoldFactory = (
  repoRoot: string,
  options: { force?: boolean; starter?: string } = {},
): ScaffoldResult => {
  const target = join(repoRoot, FACTORY_DIR);
  if (existsSync(target) && options.force !== true) {
    throw new Error(
      `${FACTORY_DIR}/ already exists in ${repoRoot}; pass --force to overwrite the starter files`,
    );
  }
  const starter = options.starter ?? STARTER_ROOT;
  const written: string[] = [];
  for (const file of starterFiles(starter)) {
    const from = join(starter, file);
    const to = join(target, file);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, readFileSync(from));
    written.push(file);
  }
  return { written };
};
