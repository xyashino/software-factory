import { PR_TEMPLATE_PATH } from '../../../config';
import { factoryBranchOf } from '../../../domain/git/branch-names';
import { joinPath } from '../../../domain/common/path';
import { checkpointMessage } from '../../../domain/git/checkpoint-policy';
import {
  prChangesOf,
  prTitleOf,
  renderPrBody,
} from '../../../domain/git/pr-body';
import type { Ports } from '../../core/procedure';
import { commitTextOf } from './checkpoint.procedure';

const ADR_NOTE = 'One entry in `decisions/` for this change.';
const VERIFICATION_NOTE =
  "Checks and proof recorded by the Work order's build station.";

export interface DeliverSpec {
  repoRoot: string;
  worktree: string;
  slug: string;
  baseBranch: string;
  priorStepIds: readonly string[];
}

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
  await ports.pr.publish({
    cwd: spec.worktree,
    branch,
    baseBranch: spec.baseBranch,
    title: prTitleOf(commitText),
    body: renderPrBody(template, {
      taskId: spec.slug,
      typeSuffix: '',
      objective: prTitleOf(commitText),
      changes: prChangesOf(commitText),
      adrSection: ADR_NOTE,
      verificationSection: VERIFICATION_NOTE,
      logCommand: '',
      reportSection: '',
    }),
  });
  const commitSha = await ports.git.headSha(spec.worktree);
  await ports.git.worktreeRemove(spec.repoRoot, spec.worktree);
  return commitSha;
};
