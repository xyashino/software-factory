import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { GithubPort } from '../ports/github.port';
import type { GitPort } from '../ports/git.port';
import type { Template } from '../definitions/types';
import { renderTemplate } from '../prompts/render';
import type { BlockedDeliveryInput, Deliverer, DeliveryInput } from './ports';
import {
  commitTitle,
  readCommitMessage,
  validateCommitMessage,
} from './delivery-commit';
import { finishMarkdown, formatPrBody, prTemplateBody } from './format-pr-body';
import { adrPaths, validateDeliveryState } from './validate-pr';

export interface DelivererDeps {
  git: GitPort;
  github: GithubPort;
  /** the ref every task branch starts from, e.g. `origin/main` */
  baseRef: string;
  /** the PR markdown templates, keyed by id (`body`, `blocked`, `report`) */
  templates: ReadonlyMap<string, Template>;
}

const commitIfDirty = async (
  git: GitPort,
  worktree: string,
  message: string,
): Promise<void> => {
  const dirty = await git.uncommittedFiles(worktree);
  if (dirty.length > 0) {
    await git.commitAll({ worktree, message });
  }
};

const prBodyFor = (
  input: DeliveryInput,
  message: string,
  added: string[],
  templates: ReadonlyMap<string, Template>,
): string => {
  const report = existsSync(input.reportFile)
    ? readFileSync(input.reportFile, 'utf8')
    : undefined;
  return formatPrBody(
    {
      taskId: input.taskId,
      todoText: existsSync(input.todoPath)
        ? readFileSync(input.todoPath, 'utf8')
        : '',
      commitMessage: message,
      report,
      adrPath: adrPaths(added)[0],
      logCommand: `sf log ${input.taskId}`,
      verification: input.verification,
    },
    templates,
  );
};

const blockedBody = (
  input: BlockedDeliveryInput,
  templates: ReadonlyMap<string, Template>,
): string => {
  return finishMarkdown(
    renderTemplate(prTemplateBody(templates, 'blocked'), {
      taskId: input.taskId,
      reason: input.reason,
      detail:
        input.detail.trim() === '' ? '_No detail recorded._' : input.detail,
      logCommand: `sf log ${input.taskId}`,
    }),
  );
};

const firstLine = (text: string): string => {
  return text.split('\n')[0]?.trim() ?? '';
};

/**
 * Delivery is idempotent: every step checks what earlier attempts already did, so
 * a supervisor restart between push and PR creation reuses the PR instead of
 * opening a second one. Pushing the same commit again is a no-op.
 */
export const createDeliverer = (deps: DelivererDeps): Deliverer => {
  const base = deps.baseRef.replace(/^origin\//, '');

  return {
    async deliver(input) {
      const message = readCommitMessage(input.commitFile);
      const messageErrors = validateCommitMessage(message);
      if (messageErrors.length > 0) throw new Error(messageErrors.join('; '));

      await deps.git.removeFile({
        worktree: input.worktree,
        path: input.todoRelPath,
      });
      await commitIfDirty(deps.git, input.worktree, message);

      const state = {
        uncommitted: await deps.git.uncommittedFiles(input.worktree),
        added: await deps.git.addedFiles({
          worktree: input.worktree,
          base: deps.baseRef,
        }),
      };
      const errors = validateDeliveryState(state);
      if (errors.length > 0) {
        throw new Error(`delivery refused: ${errors.join('; ')}`);
      }

      await deps.git.push({ worktree: input.worktree, branch: input.branch });

      const existing = await deps.github.findPr(input.branch);
      if (existing !== undefined) {
        removeTodoFile(input.todoPath);
        return { prUrl: existing.url };
      }
      const { url } = await deps.github.createPr({
        branch: input.branch,
        base,
        title: commitTitle(message),
        body: prBodyFor(input, message, state.added, deps.templates),
        draft: false,
      });
      removeTodoFile(input.todoPath);
      return { prUrl: url };
    },

    async publishBlocked(input) {
      const reason = firstLine(input.reason);
      const title = `[BLOCKED] ${input.taskId} ${reason}`;
      const uncommitted = await deps.git.uncommittedFiles(input.worktree);
      if (uncommitted.length > 0) {
        await deps.git.commitAll({
          worktree: input.worktree,
          message: `wip: ${title}`,
        });
      }
      await deps.git.push({ worktree: input.worktree, branch: input.branch });

      const existing = await deps.github.findPr(input.branch);
      if (existing !== undefined) return { prUrl: existing.url };
      const { url } = await deps.github.createPr({
        branch: input.branch,
        base,
        title,
        body: blockedBody(input, deps.templates),
        draft: true,
      });
      return { prUrl: url };
    },
  };
};

/** Deletes the delivered todo from the main checkout. Idempotent: a missing file is fine. */
export const removeTodoFile = (todoPath: string): void => {
  rmSync(todoPath, { force: true });
};
