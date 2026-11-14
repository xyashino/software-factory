import type { RunnerAdapter } from './runner';

export const opencodeRunner: RunnerAdapter = {
  name: 'opencode',
  kind: 'opencode',
  readOnly: false,
  startArgs: ({ model }) => ['--auto', '-m', model],
};
