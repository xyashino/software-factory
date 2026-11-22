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
const WHOLE_WORKTREE = '.';

export interface CheckpointSpec {
  worktree: string;
  slug: string;
  stepId: string;
  producedFiles: readonly string[];
  commits: boolean;
}

export interface CheckpointResult {
  commitSha: string;
  discarded: string[];
}

const pathsOf = (status: string): string[] =>
  status
    .split('\n')
    .map((line) => line.slice(PORCELAIN_PATH_OFFSET))
    .filter((path) => path.length > 0);

const leftoverOf = async (
  ports: Ports,
  worktree: string,
  paths: readonly string[],
): Promise<string[]> =>
  pathsOf(await ports.git.status(worktree)).filter((path) =>
    paths.some(
      (reported) => reported === WHOLE_WORKTREE || path.startsWith(reported),
    ),
  );

const discardOf = async (ports: Ports, worktree: string): Promise<string[]> => {
  const discarded = pathsOf(await ports.git.status(worktree));
  if (discarded.length > 0) {
    await ports.git.discardChanges(worktree);
  }
  return discarded;
};

const commitOf = async (ports: Ports, spec: CheckpointSpec): Promise<void> => {
  const reported = checkpointPaths(spec.producedFiles);
  // An operator reports only its `.cell/` artifacts; its code changes are whatever it left in the worktree.
  if (
    reported.length === 0 &&
    (await ports.git.status(spec.worktree)).trim() === ''
  ) {
    return;
  }
  const paths = reported.length > 0 ? reported : [WHOLE_WORKTREE];
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
};

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
): Promise<CheckpointResult> => {
  if (!spec.commits) {
    return {
      commitSha: await ports.git.headSha(spec.worktree),
      discarded: await discardOf(ports, spec.worktree),
    };
  }
  await commitOf(ports, spec);
  return {
    commitSha: await ports.git.headSha(spec.worktree),
    discarded: [],
  };
};
