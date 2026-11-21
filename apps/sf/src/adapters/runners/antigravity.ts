import { promptFor, type CommandSpec, type RunnerAdapter } from './runner';

const BINARY = 'agy';

const modelArgs = ({ model }: CommandSpec): string[] =>
  model === undefined ? [] : ['--model', model];

export const antigravityRunner: RunnerAdapter = {
  name: 'antigravity',
  buildCommand: (spec) => [
    BINARY,
    '--mode',
    'auto',
    '--dangerously-skip-permissions',
    '--output-format',
    'json',
    ...modelArgs(spec),
    '-p',
    promptFor(spec.promptFile),
  ],
  buildInteractive: (spec) => [
    BINARY,
    '--mode',
    'auto',
    '--dangerously-skip-permissions',
    ...modelArgs(spec),
    '-i',
    promptFor(spec.promptFile),
  ],
  checkInstalled: (probe) => probe(BINARY),
};
