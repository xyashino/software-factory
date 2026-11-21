import { promptFor, type CommandSpec, type RunnerAdapter } from './runner';

const BINARY = 'opencode';

const modelArgs = ({ model }: CommandSpec): string[] =>
  model === undefined ? [] : ['-m', model];

export const opencodeRunner: RunnerAdapter = {
  name: BINARY,
  buildCommand: (spec) => [
    BINARY,
    'run',
    ...modelArgs(spec),
    promptFor(spec.promptFile),
  ],
  checkInstalled: (probe) => probe(BINARY),
};
