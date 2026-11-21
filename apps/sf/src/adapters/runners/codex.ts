import { promptFor, type CommandSpec, type RunnerAdapter } from './runner';

const BINARY = 'codex';

const sandboxArgs = ({ permission }: CommandSpec): string[] =>
  permission === 'read'
    ? ['--ask-for-approval', 'never', 'exec', '--sandbox', 'read-only']
    : ['exec', '--dangerously-bypass-approvals-and-sandbox'];

const modelArgs = ({ model }: CommandSpec): string[] =>
  model === undefined ? [] : ['-m', model];

export const codexRunner: RunnerAdapter = {
  name: BINARY,
  buildCommand: (spec) => [
    BINARY,
    ...sandboxArgs(spec),
    '--json',
    ...modelArgs(spec),
    promptFor(spec.promptFile),
  ],
  checkInstalled: (probe) => probe(BINARY),
};
