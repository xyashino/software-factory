import {
  checkpointMessage,
  checkpointPaths,
} from '../../../domain/git/checkpoint-policy';
import { factoryBranchOf } from '../../../domain/git/branch-names';
import { joinPath } from '../../../domain/common/path';
import type { Ports } from '../../core/procedure';

const CELL_DIR = '.cell';
const COMMIT_FILE = 'commit.txt';
const PORCELAIN_PATH_OFFSET = 3;

export interface CheckpointSpec {
  worktree: string;
  slug: string;
  stepId: string;
  producedFiles: readonly string[];
}

const leftoverOf = async (
  ports: Ports,
  worktree: string,
  paths: readonly string[],
): Promise<string[]> =>
  (await ports.git.status(worktree))
    .split('\n')
    .map((line) => line.slice(PORCELAIN_PATH_OFFSET))
    .filter((path) => paths.some((reported) => path.startsWith(reported)));

export const commitTextOf = async (
  ports: Ports,
  worktree: string,
  stepId: string,
): Promise<string | undefined> => {
  const file = joinPath(worktree, CELL_DIR, stepId, COMMIT_FILE);
  return (await ports.fs.exists(file)) ? ports.fs.readText(file) : undefined;
};

export const checkpointStation = async (
  ports: Ports,
  spec: CheckpointSpec,
): Promise<string | undefined> => {
  const paths = checkpointPaths(spec.producedFiles);
  if (paths.length === 0) {
    return undefined;
  }
  if ((await ports.git.status(spec.worktree)).trim() === '') {
    return undefined;
  }
  const message = checkpointMessage(
    await commitTextOf(ports, spec.worktree, spec.stepId),
    spec.slug,
  );
  await ports.git.commit(spec.worktree, paths, message);
  const left = await leftoverOf(ports, spec.worktree, paths);
  if (left.length > 0) {
    throw new Error(`checkpoint left changes: ${left.join(', ')}`);
  }
  await ports.git.push(spec.worktree, factoryBranchOf(spec.slug));
  return ports.git.headSha(spec.worktree);
};
