import { PR_TEMPLATE_PATH } from '../../../config';
import { factoryBranchOf } from '../../../domain/git/branch-names';
import { joinPath } from '../../../domain/common/path';
import { checkpointMessage } from '../../../domain/git/checkpoint-policy';
import {
  extractObjective,
  formatAdrEntries,
  formatChecks,
  prChangesOf,
  prTitleOf,
  renderPrBody,
  type AdrEntry,
} from '../../../domain/git/pr-body';
import type { Ports } from '../../core/procedure';
import { commitTextOf } from './checkpoint.procedure';

export interface DeliverSpec {
  repoRoot: string;
  worktree: string;
  slug: string;
  baseBranch: string;
  priorStepIds: readonly string[];
  taskDescription?: string;
  adrPaths?: readonly string[];
  checks?: readonly string[];
}

const adrEntriesOf = (ports: Ports, spec: DeliverSpec): Promise<AdrEntry[]> =>
  Promise.all(
    (spec.adrPaths ?? []).map(async (path) => ({
      path,
      content: await ports.fs.readText(joinPath(spec.worktree, path)),
    })),
  );

const commitTextForPr = async (
  ports: Ports,
  spec: DeliverSpec,
): Promise<string | undefined> => {
  for (const stepId of [...spec.priorStepIds].reverse()) {
    const text = await commitTextOf(ports, spec.worktree, stepId);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
};

export const deliverWorkOrder = async (
  ports: Ports,
  spec: DeliverSpec,
): Promise<string> => {
  const branch = factoryBranchOf(spec.slug);
  const commitText = checkpointMessage(
    await commitTextForPr(ports, spec),
    spec.slug,
  );
  await ports.git.push(spec.worktree, branch);
  const template = await ports.fs.readText(
    joinPath(spec.repoRoot, PR_TEMPLATE_PATH),
  );
  const title = prTitleOf(commitText);
  await ports.pr.publish({
    cwd: spec.worktree,
    branch,
    baseBranch: spec.baseBranch,
    title,
    body: renderPrBody(template, {
      taskId: spec.slug,
      objective: extractObjective(spec.taskDescription ?? '', title),
      changes: prChangesOf(commitText),
      adrSection: formatAdrEntries(await adrEntriesOf(ports, spec)),
      verificationSection: formatChecks(spec.checks ?? []),
    }),
  });
  const commitSha = await ports.git.headSha(spec.worktree);
  await ports.git.worktreeRemove(spec.repoRoot, spec.worktree);
  return commitSha;
};
