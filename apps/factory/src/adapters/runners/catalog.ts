import type {
  CommandLine,
  RunnerCatalogPort,
} from '../../application/ports/runner-catalog.port';
import { getRunner, RUNNER_NAMES } from './registry';
import type { BinaryProbe } from './runner';

export const createRunnerCatalog = (probe: BinaryProbe): RunnerCatalogPort => ({
  names: () => RUNNER_NAMES,
  isInstalled: async (name) => {
    const adapter = getRunner(name);
    return adapter !== undefined && (await adapter.checkInstalled(probe));
  },
  commandLine: (name, promptFile): CommandLine | undefined => {
    const adapter = getRunner(name);
    if (adapter === undefined) return undefined;
    const [command = '', ...args] = adapter.buildCommand({
      promptFile,
      permission: 'write',
    });
    return { command, args };
  },
});
