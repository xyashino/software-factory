import { promptFor, type CommandSpec, type RunnerAdapter } from './runner';

const BINARY = 'claude';
// Read mode keeps auto approval but denies file writes outright, so a judge cannot edit files.
const READ_DENIED_TOOLS = 'Write,Edit,MultiEdit,NotebookEdit';

const permissionArgs = ({ permission }: CommandSpec): string[] =>
  permission === 'read'
    ? ['--dangerously-skip-permissions', '--disallowedTools', READ_DENIED_TOOLS]
    : ['--dangerously-skip-permissions'];

const modelArgs = ({ model }: CommandSpec): string[] =>
  model === undefined ? [] : ['--model', model];

export const claudeRunner: RunnerAdapter = {
  name: BINARY,
  buildCommand: (spec) => [
    BINARY,
    '-p',
    promptFor(spec.promptFile),
    ...permissionArgs(spec),
    '--output-format',
    'json',
    ...modelArgs(spec),
  ],
  buildInteractive: (spec) => [
    BINARY,
    ...permissionArgs(spec),
    ...modelArgs(spec),
    promptFor(spec.promptFile),
  ],
  checkInstalled: (probe) => probe(BINARY),
};
