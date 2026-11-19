import { promptFor, type CommandSpec, type RunnerAdapter } from './runner';

const BINARY = 'cursor-agent';

// Every run approves tool calls unattended; read mode also plans without edits.
const modeArgs = ({ permission }: CommandSpec): string[] =>
  permission === 'read' ? ['--mode', 'plan', '--force'] : ['--force'];

const modelArgs = ({ model }: CommandSpec): string[] =>
  model === undefined ? [] : ['--model', model];

export const cursorRunner: RunnerAdapter = {
  name: 'cursor',
  buildCommand: (spec) => [
    BINARY,
    '-p',
    ...modeArgs(spec),
    '--trust',
    '--approve-mcps',
    '--output-format',
    'json',
    ...modelArgs(spec),
    promptFor(spec.promptFile),
  ],
  checkInstalled: (probe) => probe(BINARY),
};
