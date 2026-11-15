import { join, resolve } from 'node:path';
import type { LineSnapshot } from '@repo/factory-core/line/snapshot';
import {
  FACTORY_DIR,
  loadRepoDefinitions,
} from '@repo/factory-definitions/load';

/** The working directory when a command is not given `--repo-dir`. */
export const defaultRepoDir = (): string => resolve(process.cwd());

/**
 * The Lines of `<repoDir>/.factory/`, by name, each with the snapshot a Work order pins (CORE §4.4).
 * The definitions are loaded whole: a repository whose `.factory/` is wrong is refused, every problem
 * named, so a Line never comes from a half-valid directory.
 */
export const repoLineSnapshots = async (
  repoDir: string,
): Promise<Map<string, LineSnapshot>> => {
  const loaded = await loadRepoDefinitions(repoDir);
  if (!loaded.ok) {
    throw new Error(
      loaded.error
        .map((error) => `${error.file}: ${error.field}: ${error.message}`)
        .join('; '),
    );
  }
  return new Map(
    [...loaded.value.lines].map(([name, line]) => [name, line.snapshot]),
  );
};

/** The snapshot of the Line `name` in `<repoDir>/.factory/lines/`, or a refusal naming the Lines there are. */
export const lineSnapshotOf = async (
  repoDir: string,
  name: string,
): Promise<LineSnapshot> => {
  const lines = await repoLineSnapshots(repoDir);
  const snapshot = lines.get(name);
  if (snapshot === undefined) {
    const have = [...lines.keys()].sort().join(', ') || 'none';
    throw new Error(
      `unknown line "${name}" in ${join(repoDir, FACTORY_DIR, 'lines')} (have: ${have})`,
    );
  }
  return snapshot;
};
