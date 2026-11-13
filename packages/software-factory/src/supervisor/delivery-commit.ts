import { readFileSync } from 'node:fs';

/** Subject of a monorepo commit: `type(scope): message`, scope required. */
const SUBJECT =
  /^(feat|fix|refactor|docs|test|chore|build|ci|perf|style|revert|wip)\([^()\s]+\)!?: \S.*$/;

/** The commit message the worker wrote to `commit.txt`, trimmed of trailing spaces. */
export const readCommitMessage = (commitFile: string): string => {
  const text = readFileSync(commitFile, 'utf8')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
  if (text === '') throw new Error(`commit message is empty: ${commitFile}`);
  return text;
};

/** The subject line, which becomes the PR title and commit title. */
export const commitTitle = (message: string): string => {
  return message.split('\n')[0]?.trim() ?? '';
};

/** Errors that keep the message from being a valid conventional commit. */
export const validateCommitMessage = (message: string): string[] => {
  const subject = commitTitle(message);
  return SUBJECT.test(subject)
    ? []
    : [`commit subject must be "type(scope): message", got "${subject}"`];
};
